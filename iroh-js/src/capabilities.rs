use napi_derive::napi;

/// Native behaviors Volt relies on instead of inferring safety from a package version.
#[derive(Debug, Clone)]
#[napi(object)]
pub struct BindingCapabilities {
    /// Home-relay callbacks are safe to register and report only connected relays.
    pub connected_home_relay_watch: bool,
    /// Relay configuration replacement restarts the active relay client with the new configuration.
    pub reconnect_relay: bool,
}

#[napi]
pub fn binding_capabilities() -> BindingCapabilities {
    BindingCapabilities {
        connected_home_relay_watch: true,
        reconnect_relay: true,
    }
}
