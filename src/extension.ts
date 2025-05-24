import * as vscode from "vscode";
import * as path from "path"; // Import path for handling file paths
import { showKeybindingInfoMessage } from "./keybinding";

// Define the structure for history entries
interface HistoryEntry {
  uri: vscode.Uri;
  timestamp: number; // Store timestamp (milliseconds since epoch)
}

// Define a custom Quick Pick Item that includes the URI (timestamp displayed via detail)
interface HistoryQuickPickItem extends vscode.QuickPickItem {
  uri: vscode.Uri;
}

// Key for storing history in workspace state (was global state)
const HISTORY_STORAGE_KEY = "customEditorHistory";

// Key for storing open files on exit (keep as workspace state)
const OPEN_FILES_STORAGE_KEY = "customOpenFilesOnExit";

// Variable to hold the extension context
let extensionContext: vscode.ExtensionContext | undefined;

// Array to store the URIs of the editor history (now stores HistoryEntry objects)
let editorHistory: HistoryEntry[] = [];

// Helper function to get the configured max history size
function getMaxHistorySize(): number {
  return (
    vscode.workspace
      .getConfiguration("custom-open-previous")
      .get<number>("maxHistorySize") || 255
  );
}

// Helper function to format timestamp
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0"); // Month is 0-indexed
  const day = date.getDate().toString().padStart(2, "0");
  return `${hours}:${minutes} ${year}-${month}-${day}`;
}

// Helper function to load history from workspace state
function loadHistory() {
  if (!extensionContext) return;

  // Load data expecting array of { uriString: string; timestamp: number }
  const storedData =
    extensionContext.workspaceState.get<
      { uriString: string; timestamp: number }[]
    >(HISTORY_STORAGE_KEY);

  console.log(
    `[HISTORY DEBUG] Raw storedHistory retrieved: type=${typeof storedData}, value=`,
    storedData
  );

  if (storedData && Array.isArray(storedData)) {
    try {
      editorHistory = storedData
        .map((item) => {
          try {
            // Check if timestamp is a valid number, default if not
            const timestamp =
              typeof item.timestamp === "number" && !isNaN(item.timestamp)
                ? item.timestamp
                : Date.now();
            return {
              uri: vscode.Uri.parse(item.uriString, true),
              timestamp: timestamp,
            };
          } catch (parseError) {
            console.error(
              `[HISTORY DEBUG] Failed to parse URI string: '${item.uriString}'`,
              parseError
            );
            return null;
          }
        })
        .filter((entry) => entry !== null) as HistoryEntry[]; // Filter out nulls

      console.log(
        `[HISTORY DEBUG] Loaded ${editorHistory.length} valid history entries from saved state.`
      );
    } catch (error) {
      console.error(
        "[HISTORY DEBUG] Error processing stored editor history array:",
        error
      );
      editorHistory = [];
    }
  } else {
    if (storedData) {
      console.log(
        "[HISTORY DEBUG] Stored history found but is not an array or has wrong format. Initializing empty."
      );
    } else {
      console.log(
        "[HISTORY DEBUG] No stored history found. Initializing empty."
      );
    }
    editorHistory = [];
  }
  console.log(
    `[HISTORY DEBUG] After loadHistory: typeof editorHistory = ${typeof editorHistory}, length = ${
      Array.isArray(editorHistory) ? editorHistory.length : "N/A"
    }`
  );
}

// Helper function to save the current state of editorHistory to workspace state
async function saveHistoryState() {
  if (!extensionContext) {
    return;
  }

  try {
    // Map history entries to storable format { uriString, timestamp }
    const historyToStore = editorHistory.map((entry) => ({
      uriString: entry.uri.toString(),
      timestamp: entry.timestamp,
    }));

    await extensionContext.workspaceState.update(
      HISTORY_STORAGE_KEY,
      historyToStore
    );
  } catch (error) {
    console.error("[HISTORY DEBUG] Error saving editor history state:", error);
  }
}

// Helper function to save OPEN FILES to workspace state (used in deactivate)
function saveOpenFilesState() {
  if (!extensionContext) {
    console.warn(
      "Cannot save open files state: Extension context not available."
    );
    return;
  }

  try {
    const openFileUris = vscode.workspace.textDocuments
      .filter((doc) => doc.uri.scheme === "file" && !doc.isClosed) // Only files, ensure not closed
      .map((doc) => doc.uri.toString());

    extensionContext.workspaceState.update(
      OPEN_FILES_STORAGE_KEY,
      openFileUris
    );
    console.log(
      `Saved ${openFileUris.length} open files state to workspace state.`
    );
  } catch (error) {
    console.error("Error saving open files state:", error);
  }
}

// Add this function near the other helpers
async function pruneNonExistentFilesFromHistory() {
  if (!Array.isArray(editorHistory) || editorHistory.length === 0) return;

  const validEntries: HistoryEntry[] = [];
  for (const entry of editorHistory) {
    try {
      await vscode.workspace.fs.stat(entry.uri);
      validEntries.push(entry);
    } catch {
      // File does not exist, skip it
      console.log(
        `[HISTORY DEBUG] Pruned non-existent file from history: ${entry.uri.fsPath}`
      );
    }
  }
  if (validEntries.length !== editorHistory.length) {
    editorHistory = validEntries;
    await saveHistoryState();
  }
}

export function activate(context: vscode.ExtensionContext) {
  extensionContext = context;

  // 1. Load history
  loadHistory();
  // Prune non-existent files after loading history
  pruneNonExistentFilesFromHistory().then(() => {
    const loadedHistoryUris = new Set(
      editorHistory.map((entry) => entry.uri.toString())
    );

    // 2. Get open files
    const openDocs = vscode.workspace.textDocuments.filter(
      (doc) => doc.uri.scheme === "file" && !doc.isClosed
    );

    // 3. Merge: Add open files to history if they weren't already loaded
    let addedFromOpenDocs = 0;
    const now = Date.now(); // Use consistent timestamp for merged items
    openDocs.forEach((doc) => {
      const uriString = doc.uri.toString();
      if (!loadedHistoryUris.has(uriString)) {
        const existingIndex = editorHistory.findIndex(
          (entry) => entry.uri.toString() === uriString
        );
        if (existingIndex === -1) {
          // Add as a new HistoryEntry object
          editorHistory.push({ uri: doc.uri, timestamp: now });
          addedFromOpenDocs++;
        }
      }
    });
    if (addedFromOpenDocs > 0) {
      console.log(
        `[HISTORY DEBUG] Added ${addedFromOpenDocs} files to history that were reopened by VS Code.`
      );
    }

    // 4. Ensure max history size
    const maxHistorySize = getMaxHistorySize();
    while (editorHistory.length > maxHistorySize) {
      editorHistory.shift();
    }

    console.log(
      `[HISTORY DEBUG] Final history size after startup merge: ${editorHistory.length}`
    );
  });

  // 5. Register listener
  const editorChangeListener = vscode.window.onDidChangeActiveTextEditor(
    async (editor) => {
      try {
        console.log(
          `[HISTORY DEBUG] Listener triggered. typeof editorHistory = ${typeof editorHistory}`
        );
        if (editor && editor.document.uri.scheme === "file") {
          const currentUri = editor.document.uri;
          const maxHistorySize = getMaxHistorySize();

          if (!Array.isArray(editorHistory)) {
            console.error(
              "[HISTORY DEBUG] editorHistory is NOT an array in listener! Aborting."
            );
            return;
          }

          const uriString = currentUri.toString();
          const existingIndex = editorHistory.findIndex(
            (entry) => entry.uri.toString() === uriString
          );

          if (existingIndex > -1) {
            editorHistory.splice(existingIndex, 1); // Remove old entry object
          }

          // Push new entry object with current timestamp
          editorHistory.push({ uri: currentUri, timestamp: Date.now() });

          if (editorHistory.length > maxHistorySize) {
            editorHistory.shift();
          }

          await saveHistoryState();
        }
      } catch (error) {
        console.error(
          "[HISTORY DEBUG] Error inside editorChangeListener:",
          error
        );
      }
    }
  );

  // 6. Register command
  const disposable = vscode.commands.registerCommand(
    "custom.openPreviousEditorFromHistory",
    async () => {
      // Prune non-existent files before showing QuickPick
      await pruneNonExistentFilesFromHistory();
      const currentEditorUriString =
        vscode.window.activeTextEditor?.document.uri.toString();

      console.log(
        `[HISTORY DEBUG] Command triggered. typeof editorHistory = ${typeof editorHistory}, length = ${
          Array.isArray(editorHistory) ? editorHistory.length : "N/A"
        }`
      );
      if (!Array.isArray(editorHistory)) {
        console.error(
          "[HISTORY DEBUG] editorHistory is NOT an array in command! Aborting."
        );
        vscode.window.showErrorMessage(
          "Editor history is currently unavailable."
        );
        return;
      }

      // Filter out the currently active editor before displaying
      const historyToDisplay = currentEditorUriString
        ? editorHistory.filter(
            (entry) => entry.uri.toString() !== currentEditorUriString
          )
        : editorHistory;

      if (historyToDisplay.length === 0) {
        vscode.window.showInformationMessage(
          "No other editors in history available."
        );
        return;
      }

      // Create QuickPick items, mapping HistoryEntry to HistoryQuickPickItem
      const historyItems: HistoryQuickPickItem[] = [...historyToDisplay]
        .reverse() // Newest first
        .map((entry) => ({
          label: `$(file) ${path.basename(entry.uri.fsPath)}`,
          description: vscode.workspace.asRelativePath(entry.uri, false),
          detail: formatTimestamp(entry.timestamp), // Add formatted timestamp to detail
          uri: entry.uri, // Keep URI for opening
        }));

      const selectedItem =
        await vscode.window.showQuickPick<HistoryQuickPickItem>(historyItems, {
          placeHolder: "Search editor history (most recent first)",
          matchOnDescription: true,
          matchOnDetail: true, // Allow searching in the timestamp detail
        });

      if (selectedItem && selectedItem.uri) {
        try {
          const document = await vscode.workspace.openTextDocument(
            selectedItem.uri
          );
          await vscode.window.showTextDocument(document);
        } catch (error) {
          console.error("Error opening document:", error);
          vscode.window.showErrorMessage(
            `Failed to open ${vscode.workspace.asRelativePath(
              selectedItem.uri
            )}`
          );
        }
      }
    }
  );

  context.subscriptions.push(disposable, editorChangeListener);
  // After registering command, show keybinding info message
  showKeybindingInfoMessage();
}

export async function deactivate() {
  // Only clean up context reference, remove saving logic from here
  // as it seems unreliable during shutdown.
  // Saving now happens only within the editorChangeListener.
  extensionContext = undefined;
}
