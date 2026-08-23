/// Native behaviors Volt relies on instead of inferring safety from a package version.
#[derive(Debug, Clone, uniffi::Record)]
pub struct BindingCapabilities {
    /// Home-relay callbacks are safe to register from foreign threads and report only connected relays.
    pub connected_home_relay_watch: bool,
    /// Relay configuration replacement restarts the active relay client with the new configuration.
    pub reconnect_relay: bool,
}

#[uniffi::export]
pub fn binding_capabilities() -> BindingCapabilities {
    BindingCapabilities {
        connected_home_relay_watch: true,
        reconnect_relay: true,
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn advertises_relay_recovery_capabilities() {
        let capabilities = super::binding_capabilities();
        assert!(capabilities.connected_home_relay_watch);
        assert!(capabilities.reconnect_relay);
    }
}
