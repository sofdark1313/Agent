export type AppCommand =
  | "newChat"
  | "newProjectlessChat"
  | "openFolder"
  | "focusComposer"
  | "toggleSidebar"
  | "toggleProjectTools";

const APP_COMMAND_EVENT = "agent:app-command";

export function dispatchAppCommand(command: AppCommand) {
  window.dispatchEvent(new CustomEvent<AppCommand>(APP_COMMAND_EVENT, { detail: command }));
}

export function subscribeAppCommand(listener: (command: AppCommand) => void) {
  const handleCommand = (event: Event) => {
    listener((event as CustomEvent<AppCommand>).detail);
  };

  window.addEventListener(APP_COMMAND_EVENT, handleCommand);
  return () => window.removeEventListener(APP_COMMAND_EVENT, handleCommand);
}
