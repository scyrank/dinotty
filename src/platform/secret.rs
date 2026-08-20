//! OS-backed protection for persisted application secrets.
//!
//! Windows uses DPAPI scoped to the current user and machine. Other platforms
//! retain the existing private-file behavior until a platform keyring backend
//! is introduced.

#[cfg(windows)]
const DPAPI_PREFIX: &[u8] = b"dpapi:";

/// Encode bytes for persistent storage.
///
/// # Errors
///
/// Returns an error when the operating-system secret store cannot protect the
/// data or when the input is too large for the platform API.
pub fn encode_persisted(data: &[u8]) -> Result<Vec<u8>, String> {
    #[cfg(windows)]
    {
        use base64::Engine;

        let protected = protect_for_current_user(data)?;
        let encoded = base64::engine::general_purpose::STANDARD.encode(protected);
        let mut output = Vec::with_capacity(DPAPI_PREFIX.len() + encoded.len());
        output.extend_from_slice(DPAPI_PREFIX);
        output.extend_from_slice(encoded.as_bytes());
        Ok(output)
    }

    #[cfg(not(windows))]
    {
        Ok(data.to_vec())
    }
}

/// Decode persisted bytes and report whether they already use the current
/// platform protection format. A false flag indicates a legacy plaintext file.
///
/// # Errors
///
/// Returns an error when the protected envelope is malformed or the
/// operating-system secret store cannot decrypt it for the current user.
pub fn decode_persisted(data: &[u8]) -> Result<(Vec<u8>, bool), String> {
    #[cfg(windows)]
    {
        use base64::Engine;

        let Some(encoded) = data.strip_prefix(DPAPI_PREFIX) else {
            return Ok((data.to_vec(), false));
        };
        let protected = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|error| format!("invalid DPAPI envelope: {error}"))?;
        Ok((unprotect_for_current_user(&protected)?, true))
    }

    #[cfg(not(windows))]
    {
        Ok((data.to_vec(), true))
    }
}

#[cfg(windows)]
fn protect_for_current_user(data: &[u8]) -> Result<Vec<u8>, String> {
    use std::ptr;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let length = u32::try_from(data.len()).map_err(|_| "secret is too large".to_string())?;
    let input = CRYPT_INTEGER_BLOB { cbData: length, pbData: data.as_ptr().cast_mut() };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let succeeded = unsafe {
        CryptProtectData(
            &raw const input,
            ptr::null(),
            ptr::null(),
            ptr::null(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &raw mut output,
        )
    };
    if succeeded == 0 {
        return Err(format!("CryptProtectData failed: {}", std::io::Error::last_os_error()));
    }
    let result = unsafe {
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(output.pbData.cast());
        bytes
    };
    Ok(result)
}

#[cfg(windows)]
fn unprotect_for_current_user(data: &[u8]) -> Result<Vec<u8>, String> {
    use std::ptr;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let length =
        u32::try_from(data.len()).map_err(|_| "protected secret is too large".to_string())?;
    let input = CRYPT_INTEGER_BLOB { cbData: length, pbData: data.as_ptr().cast_mut() };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let succeeded = unsafe {
        CryptUnprotectData(
            &raw const input,
            ptr::null_mut(),
            ptr::null(),
            ptr::null(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &raw mut output,
        )
    };
    if succeeded == 0 {
        return Err(format!("CryptUnprotectData failed: {}", std::io::Error::last_os_error()));
    }
    let result = unsafe {
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(output.pbData.cast());
        bytes
    };
    Ok(result)
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn dpapi_storage_round_trip_and_plaintext_migration() {
        let plaintext = b"dinotty-secret-test";
        let encoded = super::encode_persisted(plaintext).unwrap();
        assert!(encoded.starts_with(super::DPAPI_PREFIX));
        assert!(!encoded.windows(plaintext.len()).any(|window| window == plaintext));

        let (decoded, protected) = super::decode_persisted(&encoded).unwrap();
        assert_eq!(decoded, plaintext);
        assert!(protected);

        let (legacy, protected) = super::decode_persisted(plaintext).unwrap();
        assert_eq!(legacy, plaintext);
        assert!(!protected);
    }
}
