use thiserror::Error;

/// Service name used for every keychain entry this app creates.
/// Mirrors the Tauri bundle identifier.
pub const KEYCHAIN_SERVICE: &str = "com.devcom.release-manager";

#[derive(Debug, Error)]
pub enum SecretError {
    #[error("keyring: {0}")]
    Keyring(#[from] keyring::Error),
}

/// Thin wrapper over the OS keychain. On Windows this is Credential Manager
/// (via DPAPI), on macOS the Keychain, on Linux the Secret Service.
#[derive(Debug, Clone, Default)]
pub struct SecretStore;

impl SecretStore {
    pub fn new() -> Self {
        Self
    }

    /// Returns `Ok(Some(value))` if a secret exists, `Ok(None)` if not, or
    /// `Err` only for genuine OS errors.
    pub fn get(&self, key: &str) -> Result<Option<String>, SecretError> {
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, key)?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(SecretError::Keyring(e)),
        }
    }

    pub fn has(&self, key: &str) -> Result<bool, SecretError> {
        Ok(self.get(key)?.is_some())
    }

    pub fn set(&self, key: &str, value: &str) -> Result<(), SecretError> {
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, key)?;
        entry.set_password(value)?;
        Ok(())
    }

    pub fn delete(&self, key: &str) -> Result<(), SecretError> {
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, key)?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(SecretError::Keyring(e)),
        }
    }
}

/// Well-known keychain entry names.
pub mod keys {
    pub const JIRA_TOKEN: &str = "jira_token";
    pub const GITLAB_TOKEN: &str = "gitlab_token";
}
