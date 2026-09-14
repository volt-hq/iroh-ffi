use std::{io::Cursor, sync::Arc};

use rustls::{
    CertificateError, ClientConnection, Error, ServerConfig, ServerConnection,
    pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName},
};

use crate::EndpointBuilder;

const ROOT: &[u8] = include_bytes!("../tests/fixtures/tls/root.der");
const OTHER_ROOT: &[u8] = include_bytes!("../tests/fixtures/tls/other-root.der");
const SERVER: &[u8] = include_bytes!("../tests/fixtures/tls/server.der");
const EXPIRED: &[u8] = include_bytes!("../tests/fixtures/tls/expired.der");
const KEY: &[u8] = include_bytes!("../tests/fixtures/tls/server-key.der");

// Exercise the TLS config on the bound endpoint, not a separately constructed
// verifier. All handshake bytes stay in memory; no public service is contacted.
fn handshake(
    config: rustls::ClientConfig,
    certificate: &[u8],
    name: &'static str,
) -> Result<(), Error> {
    let server_config = ServerConfig::builder_with_provider(config.crypto_provider().clone())
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(
            vec![CertificateDer::from(certificate.to_vec())],
            PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(KEY.to_vec())),
        )
        .unwrap();
    let mut server = ServerConnection::new(Arc::new(server_config)).unwrap();
    let mut client =
        ClientConnection::new(Arc::new(config), ServerName::try_from(name).unwrap()).unwrap();
    for _ in 0..16 {
        let mut bytes = Vec::new();
        client.write_tls(&mut bytes).unwrap();
        server.read_tls(&mut Cursor::new(bytes)).unwrap();
        server.process_new_packets()?;
        let mut bytes = Vec::new();
        server.write_tls(&mut bytes).unwrap();
        client.read_tls(&mut Cursor::new(bytes)).unwrap();
        client.process_new_packets()?;
        if !client.is_handshaking() && !server.is_handshaking() {
            return Ok(());
        }
    }
    panic!("TLS handshake did not converge");
}

#[tokio::test]
async fn custom_roots_enforce_tls_verification() {
    let builder = EndpointBuilder::new();
    builder.apply_minimal();
    builder.ca_roots(vec![ROOT.to_vec()]).unwrap();
    let endpoint = builder.bind().await.unwrap();
    let config = endpoint.raw().tls_config().clone();
    handshake(config.clone(), SERVER, "localhost").unwrap();
    handshake(config.clone(), SERVER, "127.0.0.1").unwrap();
    assert!(matches!(
        handshake(config.clone(), SERVER, "wrong.invalid"),
        Err(Error::InvalidCertificate(
            CertificateError::NotValidForNameContext { .. }
        ))
    ));
    assert!(matches!(
        handshake(config.clone(), EXPIRED, "localhost"),
        Err(Error::InvalidCertificate(
            CertificateError::ExpiredContext { .. }
        ))
    ));
    let mut bad_signature = SERVER.to_vec();
    *bad_signature.last_mut().unwrap() ^= 1;
    assert!(matches!(
        handshake(config, &bad_signature, "localhost"),
        Err(Error::InvalidCertificate(CertificateError::BadSignature))
    ));
    endpoint.close().await.unwrap();
    assert!(builder.ca_roots(vec![ROOT.to_vec()]).is_err());
}

#[tokio::test]
async fn default_and_wrong_roots_reject_private_authority() {
    for roots in [None, Some(vec![OTHER_ROOT.to_vec()])] {
        let builder = EndpointBuilder::new();
        builder.apply_minimal();
        if let Some(roots) = roots {
            builder.ca_roots(roots).unwrap();
        }
        let endpoint = builder.bind().await.unwrap();
        assert!(matches!(
            handshake(endpoint.raw().tls_config().clone(), SERVER, "localhost"),
            Err(Error::InvalidCertificate(CertificateError::UnknownIssuer))
        ));
        endpoint.close().await.unwrap();
    }
}

#[tokio::test]
async fn invalid_roots_leave_existing_builder_configuration_intact() {
    let builder = EndpointBuilder::new();
    builder.apply_minimal();
    builder.ca_roots(vec![ROOT.to_vec()]).unwrap();
    for invalid in [
        vec![],
        vec![vec![]],
        vec![ROOT.to_vec(); 9],
        vec![vec![0; 16 * 1024 + 1]],
        vec![b"not DER".to_vec()],
        vec![ROOT.to_vec(), b"not DER".to_vec()],
    ] {
        assert!(builder.ca_roots(invalid).is_err());
    }
    let endpoint = builder.bind().await.unwrap();
    handshake(endpoint.raw().tls_config().clone(), SERVER, "localhost").unwrap();
    endpoint.close().await.unwrap();
}

#[tokio::test]
async fn replacing_roots_drops_previous_authority() {
    let builder = EndpointBuilder::new();
    builder.apply_minimal();
    builder.ca_roots(vec![ROOT.to_vec()]).unwrap();
    builder.ca_roots(vec![OTHER_ROOT.to_vec()]).unwrap();
    let endpoint = builder.bind().await.unwrap();
    assert!(matches!(
        handshake(endpoint.raw().tls_config().clone(), SERVER, "localhost"),
        Err(Error::InvalidCertificate(CertificateError::UnknownIssuer))
    ));
    endpoint.close().await.unwrap();
}
