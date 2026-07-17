fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let package_json = std::path::Path::new(&manifest_dir)
        .join("..")
        .join("package.json");
    println!("cargo:rerun-if-changed={}", package_json.display());
    println!("cargo:rerun-if-env-changed=LIVEAGENT_APP_VERSION");

    let app_version = std::env::var("LIVEAGENT_APP_VERSION")
        .ok()
        .map(|version| version.trim().to_owned())
        .filter(|version| !version.is_empty())
        .unwrap_or_else(|| {
            let package_json_text =
                std::fs::read_to_string(&package_json).expect("read app package.json for version");
            let package_json_value: serde_json::Value = serde_json::from_str(&package_json_text)
                .expect("parse app package.json for version");
            package_json_value
                .get("version")
                .and_then(serde_json::Value::as_str)
                .filter(|version| !version.trim().is_empty())
                .expect("app package.json version must be a non-empty string")
                .trim()
                .to_owned()
        });
    println!("cargo:rustc-env=LIVEAGENT_APP_VERSION={app_version}");

    let proto_dir = std::path::Path::new(&manifest_dir)
        .join("..")
        .join("..")
        .join("agent-gateway")
        .join("proto")
        .join("v1");
    let proto_file = proto_dir.join("gateway.proto");

    println!("cargo:rerun-if-changed={}", proto_file.display());

    tonic_prost_build::configure()
        .build_server(false)
        .compile_protos(&[proto_file], &[proto_dir])
        .expect("compile gateway proto");

    tauri_build::build()
}
