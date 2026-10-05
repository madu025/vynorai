import { pathToFileURL } from "node:url";
import { inferResolvedUriFromRelativePath } from "../../util/ideUtils";

import { ToolImpl } from ".";
import { throwIfFileIsSecurityConcern } from "../../indexing/ignore";
import {
  findUriInDirs,
  getCleanUriPath,
  getUriPathBasename,
  joinEncodedUriPathSegmentToUri,
} from "../../util/uri";
import { getStringArg } from "../parseArgs";
import { ContinueError, ContinueErrorReason } from "../../util/errors";

/**
 * An absolute path or file:// URI inside a workspace folder maps to that
 * folder's URI. Joined as relative, "D:\proj\a.ts" became
 * "<root>/D%3A/proj/a.ts". Returns null for anything that isn't absolute.
 */
async function resolveAbsoluteInWorkspace(
  filepath: string,
  ide: Parameters<ToolImpl>[1]["ide"],
): Promise<string | null> {
  const trimmed = filepath.trim();
  const isWindowsAbsolute =
    /^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith("\\\\");
  const uri = trimmed.startsWith("file://")
    ? trimmed
    : isWindowsAbsolute || trimmed.startsWith("/")
      ? pathToFileURL(trimmed).href
      : null;
  if (!uri) return null;
  const { foundInDir, relativePathOrBasename } = findUriInDirs(
    uri,
    await ide.getWorkspaceDirs(),
  );
  if (foundInDir) {
    return joinEncodedUriPathSegmentToUri(
      foundInDir,
      relativePathOrBasename.split("/").map(encodeURIComponent).join("/"),
    );
  }
  // "/src/a.ts" is usually meant relative to the workspace root.
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return null;
  throw new ContinueError(
    ContinueErrorReason.PathResolutionFailed,
    `${filepath} is outside the workspace; create files inside the workspace`,
  );
}

export const createNewFileImpl: ToolImpl = async (args, extras) => {
  const filepath = getStringArg(args, "filepath");
  const contents = getStringArg(args, "contents", true);

  const resolvedFileUri =
    (await resolveAbsoluteInWorkspace(filepath, extras.ide)) ??
    (await inferResolvedUriFromRelativePath(filepath, extras.ide));
  if (resolvedFileUri) {
    throwIfFileIsSecurityConcern(getCleanUriPath(resolvedFileUri));
    const exists = await extras.ide.fileExists(resolvedFileUri);
    if (exists) {
      throw new ContinueError(
        ContinueErrorReason.FileAlreadyExists,
        `File ${filepath} already exists. Use the edit tool to edit this file`,
      );
    }
    await extras.ide.writeFile(resolvedFileUri, contents);
    await extras.ide.openFile(resolvedFileUri);
    await extras.ide.saveFile(resolvedFileUri);
    if (extras.codeBaseIndexer) {
      void extras.codeBaseIndexer?.refreshCodebaseIndexFiles([resolvedFileUri]);
    }
    return [
      {
        name: getUriPathBasename(resolvedFileUri),
        description: getCleanUriPath(resolvedFileUri),
        content: "File created successfuly",
        uri: {
          type: "file",
          value: resolvedFileUri,
        },
      },
    ];
  } else {
    throw new ContinueError(
      ContinueErrorReason.PathResolutionFailed,
      "Failed to resolve path",
    );
  }
};
