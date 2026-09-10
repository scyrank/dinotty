#![allow(clippy::unwrap_used, clippy::expect_used, clippy::too_many_lines)]
use axum::{
    body::Body,
    http::{header, StatusCode},
    response::Response,
};
use futures_util::StreamExt;

use super::rewrite::{
    rewrite_css_urls, rewrite_html_urls, rewrite_js_imports, rewrite_set_cookie, rewrite_url,
    RewriteMode,
};
use super::BASE_TAG_RE;

const MAX_REWRITE_BODY_BYTES: usize = 32 * 1024 * 1024;

fn rewrite_body_error(status: StatusCode, message: &'static str) -> Response {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(message))
        .unwrap()
}

fn rewrite_body_would_exceed_limit(current: usize, incoming: usize) -> bool {
    incoming > MAX_REWRITE_BODY_BYTES.saturating_sub(current)
}

async fn read_rewrite_body(
    upstream_resp: reqwest::Response,
) -> Result<bytes::Bytes, Box<Response>> {
    let content_length = upstream_resp.content_length();
    if content_length.is_some_and(|length| length > MAX_REWRITE_BODY_BYTES as u64) {
        return Err(Box::new(rewrite_body_error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Proxy response is too large to rewrite",
        )));
    }

    let initial_capacity =
        content_length.and_then(|length| usize::try_from(length).ok()).unwrap_or(0);
    let mut body = Vec::with_capacity(initial_capacity.min(MAX_REWRITE_BODY_BYTES));
    let mut stream = upstream_resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| {
            Box::new(rewrite_body_error(StatusCode::BAD_GATEWAY, "Failed to read proxy response"))
        })?;
        if rewrite_body_would_exceed_limit(body.len(), chunk.len()) {
            return Err(Box::new(rewrite_body_error(
                StatusCode::PAYLOAD_TOO_LARGE,
                "Proxy response is too large to rewrite",
            )));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(bytes::Bytes::from(body))
}

pub async fn build_proxied_response(
    upstream_resp: reqwest::Response,
    inject_base: &str,
    inject_script: &str,
    rewrite_mode: Option<RewriteMode>,
) -> Response {
    let status = upstream_resp.status();
    let resp_headers = upstream_resp.headers().clone();
    let content_type = resp_headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let is_html = content_type.contains("text/html");
    let is_css = content_type.contains("text/css");
    let is_js = content_type.contains("javascript") || content_type.contains("ecmascript");
    let may_rewrite = is_html
        || is_css
        || is_js
        || (matches!(&rewrite_mode, Some(RewriteMode::Internal { .. }))
            && (content_type.is_empty() || content_type.starts_with("text/")));

    let mut builder = Response::builder().status(status.as_u16());
    for (name, value) in &resp_headers {
        let n = name.as_str();
        if n == "transfer-encoding"
            || n == "connection"
            || n == "x-frame-options"
            || n == "content-security-policy"
            || n == "content-security-policy-report-only"
            || n == "content-encoding"
        {
            continue;
        }
        if may_rewrite && n == "content-length" {
            continue;
        }
        if n == "location" {
            if let (Ok(loc), Some(mode)) = (value.to_str(), &rewrite_mode) {
                let base = match mode {
                    RewriteMode::Internal { ref host, port } => format!("http://{host}:{port}"),
                    RewriteMode::External(url) => url.clone(),
                };
                if let Some(rewritten) = rewrite_url(loc, &base, mode) {
                    builder = builder.header(n, rewritten);
                    continue;
                }
            }
        }
        if n == "set-cookie" {
            if let Ok(cookie_str) = value.to_str() {
                let rewritten = rewrite_set_cookie(cookie_str, rewrite_mode.as_ref());
                builder = builder.header(n, rewritten);
                continue;
            }
        }
        builder = builder.header(n, value);
    }

    if is_html {
        let inject = format!("{inject_base}{inject_script}");
        let full_body = match read_rewrite_body(upstream_resp).await {
            Ok(body) => body,
            Err(response) => return *response,
        };
        let html_raw = String::from_utf8_lossy(&full_body);
        let html = BASE_TAG_RE.replace_all(&html_raw, "");
        let html = if let Some(mode) = &rewrite_mode {
            let base = match mode {
                RewriteMode::Internal { ref host, port } => format!("http://{host}:{port}"),
                RewriteMode::External(ref url) => url.clone(),
            };
            std::borrow::Cow::Owned(rewrite_html_urls(&html, &base, mode))
        } else {
            html
        };
        let mut buf = String::with_capacity(html.len() + inject.len());
        if let Some(pos) = html.find("<head>") {
            buf.push_str(&html[..pos + 6]);
            buf.push_str(&inject);
            buf.push_str(&html[pos + 6..]);
        } else if let Some(pos) = html.find("</head>") {
            buf.push_str(&html[..pos]);
            buf.push_str(&inject);
            buf.push_str(&html[pos..]);
        } else {
            buf.push_str(&inject);
            buf.push_str(&html);
        }
        builder.header(header::CONTENT_LENGTH, buf.len()).body(Body::from(buf)).unwrap()
    } else if is_css {
        if let Some(mode) = &rewrite_mode {
            let base = match mode {
                RewriteMode::Internal { ref host, port } => format!("http://{host}:{port}"),
                RewriteMode::External(ref url) => url.clone(),
            };
            let full_body = match read_rewrite_body(upstream_resp).await {
                Ok(body) => body,
                Err(response) => return *response,
            };
            let css_raw = String::from_utf8_lossy(&full_body);
            let rewritten = rewrite_css_urls(&css_raw, &base, mode);
            builder
                .header(header::CONTENT_LENGTH, rewritten.len())
                .body(Body::from(rewritten))
                .unwrap()
        } else {
            let stream =
                upstream_resp.bytes_stream().map(|result| result.map_err(std::io::Error::other));
            builder.body(Body::from_stream(stream)).unwrap()
        }
    } else if is_js {
        if let Some(mode) = &rewrite_mode {
            let full_body = match read_rewrite_body(upstream_resp).await {
                Ok(body) => body,
                Err(response) => return *response,
            };
            let js_raw = String::from_utf8_lossy(&full_body);
            let rewritten = rewrite_js_imports(&js_raw, mode);
            builder
                .header(header::CONTENT_LENGTH, rewritten.len())
                .body(Body::from(rewritten))
                .unwrap()
        } else {
            let stream =
                upstream_resp.bytes_stream().map(|result| result.map_err(std::io::Error::other));
            builder.body(Body::from_stream(stream)).unwrap()
        }
    } else if let Some(mode @ RewriteMode::Internal { .. }) = &rewrite_mode {
        if content_type.is_empty()
            || (content_type.starts_with("text/")
                && !content_type.contains("text/css")
                && !content_type.contains("text/html"))
        {
            let full_body = match read_rewrite_body(upstream_resp).await {
                Ok(body) => body,
                Err(response) => return *response,
            };
            let text = String::from_utf8_lossy(&full_body);
            let trimmed = text.trim_start();
            if trimmed.starts_with("import ")
                || trimmed.starts_with("import{")
                || trimmed.starts_with("import(")
                || trimmed.starts_with("export ")
                || trimmed.starts_with("export{")
                || trimmed.starts_with("from ")
                || trimmed.starts_with("const ")
                || trimmed.starts_with("var ")
                || trimmed.starts_with("let ")
            {
                let rewritten = rewrite_js_imports(&text, mode);
                builder
                    .header(header::CONTENT_LENGTH, rewritten.len())
                    .body(Body::from(rewritten))
                    .unwrap()
            } else {
                builder
                    .header(header::CONTENT_LENGTH, full_body.len())
                    .body(Body::from(full_body))
                    .unwrap()
            }
        } else {
            let stream =
                upstream_resp.bytes_stream().map(|result| result.map_err(std::io::Error::other));
            builder.body(Body::from_stream(stream)).unwrap()
        }
    } else {
        let stream =
            upstream_resp.bytes_stream().map(|result| result.map_err(std::io::Error::other));
        builder.body(Body::from_stream(stream)).unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::{rewrite_body_would_exceed_limit, MAX_REWRITE_BODY_BYTES};

    #[test]
    fn rewrite_body_limit_accepts_exact_boundary() {
        assert!(!rewrite_body_would_exceed_limit(MAX_REWRITE_BODY_BYTES - 1, 1));
        assert!(!rewrite_body_would_exceed_limit(0, MAX_REWRITE_BODY_BYTES));
    }

    #[test]
    fn rewrite_body_limit_rejects_overflow() {
        assert!(rewrite_body_would_exceed_limit(MAX_REWRITE_BODY_BYTES, 1));
        assert!(rewrite_body_would_exceed_limit(MAX_REWRITE_BODY_BYTES - 1, 2));
        assert!(rewrite_body_would_exceed_limit(usize::MAX, usize::MAX));
    }
}
