// Utility to inform users how to set or override the QuickFile Recall keybinding in VS Code.
import * as vscode from "vscode";

const COMMAND_ID = "custom.openPreviousEditorFromHistory";
const MAC_KEY = "cmd+e";
const WIN_LINUX_KEY = "ctrl+e";

export async function showKeybindingInfoMessage() {
  // Get all keybindings for the command
  const keybindings = await vscode.commands.executeCommand<any[]>(
    "vscode.getKeybindings",
    {}
  );
  const platform = process.platform;
  const expectedKey = platform === "darwin" ? MAC_KEY : WIN_LINUX_KEY;
  const isSet = (keybindings || []).some(
    (kb: any) =>
      kb.command === COMMAND_ID &&
      kb.key &&
      kb.key.toLowerCase() === expectedKey
  );
  if (isSet) {
    return; // Shortcut is already set, do not show message
  }

  const picked = await vscode.window.showInformationMessage(
    "To use QuickFile Recall with CMD+E (Mac) or CTRL+E (Win/Linux), you may need to override the default VS Code shortcut. Would you like to open Keyboard Shortcuts to set it now?",
    "Open Keyboard Shortcuts",
    "Show Instructions",
    "Dismiss"
  );

  if (picked === "Open Keyboard Shortcuts") {
    await vscode.commands.executeCommand(
      "workbench.action.openGlobalKeybindings"
    );
    vscode.window.showInformationMessage(
      'Search for "QuickFile Recall: Open Previous File" and set the keybinding to CMD+E (Mac) or CTRL+E (Win/Linux).'
    );
  } else if (picked === "Show Instructions") {
    vscode.window.showInformationMessage(
      'To set CMD+E (Mac) or CTRL+E (Win/Linux) for QuickFile Recall: 1) Open Keyboard Shortcuts (CMD+K, CMD+S), 2) Search for "QuickFile Recall: Open Previous File", 3) Set the keybinding to CMD+E (Mac) or CTRL+E (Win/Linux).'
    );
  }
}
