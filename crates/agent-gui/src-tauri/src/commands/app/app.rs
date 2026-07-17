use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::runtime::terminal::TerminalSessionRegistry;

#[allow(dead_code)]
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MacOsTrafficLightMetrics {
    pub top: f64,
    pub left: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePlatformResponse {
    pub platform: &'static str,
}

#[tauri::command]
pub fn app_runtime_platform() -> RuntimePlatformResponse {
    let platform = if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    RuntimePlatformResponse { platform }
}

#[tauri::command]
pub fn app_confirmed_exit(
    app: AppHandle,
    allow_exit: State<'_, Arc<AtomicBool>>,
    terminal_registry: State<'_, Arc<TerminalSessionRegistry>>,
) -> Result<(), String> {
    terminal_registry.close_all()?;
    allow_exit.store(true, Ordering::SeqCst);
    app.exit(0);
    Ok(())
}

#[allow(dead_code)]
#[tauri::command]
pub async fn app_macos_traffic_light_metrics(
    window: tauri::Window,
) -> Result<Option<MacOsTrafficLightMetrics>, String> {
    read_macos_traffic_light_metrics(window).await
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
async fn read_macos_traffic_light_metrics(
    _window: tauri::Window,
) -> Result<Option<MacOsTrafficLightMetrics>, String> {
    Ok(None)
}

#[cfg(target_os = "macos")]
#[allow(dead_code)]
async fn read_macos_traffic_light_metrics(
    window: tauri::Window,
) -> Result<Option<MacOsTrafficLightMetrics>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let window_for_task = window.clone();
    window
        .run_on_main_thread(move || {
            let result = read_macos_traffic_light_metrics_on_main_thread(&window_for_task);
            let _ = tx.send(result);
        })
        .map_err(|error| format!("failed to read macOS traffic light metrics: {error}"))?;

    rx.await
        .map_err(|_| "failed to receive macOS traffic light metrics".to_string())?
}

#[cfg(target_os = "macos")]
#[allow(dead_code)]
fn read_macos_traffic_light_metrics_on_main_thread(
    window: &tauri::Window,
) -> Result<Option<MacOsTrafficLightMetrics>, String> {
    use objc2_app_kit::{NSWindow, NSWindowButton};

    let ns_window_ptr = window
        .ns_window()
        .map_err(|error| format!("failed to get native macOS window: {error}"))?;
    if ns_window_ptr.is_null() {
        return Ok(None);
    }

    let ns_window: &NSWindow = unsafe { &*ns_window_ptr.cast::<NSWindow>() };
    let window_frame = ns_window.frame();

    let button_frames = [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ]
    .into_iter()
    .filter_map(|button| ns_window.standardWindowButton(button))
    .map(|button| macos_window_button_screen_frame(ns_window, &button))
    .collect::<Vec<_>>();

    if button_frames.is_empty() {
        return Ok(None);
    }

    let min_x = button_frames
        .iter()
        .map(|frame| frame.0)
        .fold(f64::INFINITY, f64::min);
    let min_y = button_frames
        .iter()
        .map(|frame| frame.1)
        .fold(f64::INFINITY, f64::min);
    let max_x = button_frames
        .iter()
        .map(|frame| frame.0 + frame.2)
        .fold(f64::NEG_INFINITY, f64::max);
    let max_y = button_frames
        .iter()
        .map(|frame| frame.1 + frame.3)
        .fold(f64::NEG_INFINITY, f64::max);
    let width = max_x - min_x;
    let height = max_y - min_y;
    let top_from_top_edge = min_y - window_frame.origin.y;
    let top_from_bottom_edge = window_frame.origin.y + window_frame.size.height - max_y;
    let top = [top_from_top_edge, top_from_bottom_edge]
        .into_iter()
        .filter(|value| value.is_finite() && *value >= 0.0)
        .min_by(|left, right| left.partial_cmp(right).unwrap())
        .unwrap_or(top_from_bottom_edge);
    let left = min_x - window_frame.origin.x;

    if [top, left, width, height]
        .iter()
        .any(|value| !value.is_finite())
        || width <= 0.0
        || height <= 0.0
    {
        return Ok(None);
    }

    Ok(Some(MacOsTrafficLightMetrics {
        top,
        left,
        width,
        height,
    }))
}

#[cfg(target_os = "macos")]
#[allow(dead_code)]
fn macos_window_button_screen_frame(
    ns_window: &objc2_app_kit::NSWindow,
    button: &objc2_app_kit::NSButton,
) -> (f64, f64, f64, f64) {
    use objc2_app_kit::NSView;

    let frame = NSView::frame(button);
    let window_frame = unsafe {
        NSView::superview(button)
            .map(|superview| superview.convertRect_toView(frame, None))
            .unwrap_or(frame)
    };
    let screen_frame = ns_window.convertRectToScreen(window_frame);
    (
        screen_frame.origin.x,
        screen_frame.origin.y,
        screen_frame.size.width,
        screen_frame.size.height,
    )
}
