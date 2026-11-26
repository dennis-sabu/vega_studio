"use client";

import {
  Braces,
  Cpu,
  File,
  FileCode,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  Hammer,
  Lock,
} from "lucide-react";

interface FileIconProps {
  name: string;
  kind: "file" | "dir";
  extension?: string;
  expanded?: boolean;
  accessible?: boolean;
  className?: string;
}

export function FileIcon({
  name,
  kind,
  extension = "",
  expanded = false,
  accessible = true,
  className = "h-3.5 w-3.5",
}: FileIconProps) {
  if (!accessible) {
    return <Lock className={`${className} shrink-0 text-amber-300`} />;
  }

  if (kind === "dir") {
    return expanded ? (
      <FolderOpen className={`${className} shrink-0 text-[#7AA2FF]`} />
    ) : (
      <Folder className={`${className} shrink-0 text-[#7AA2FF]`} />
    );
  }

  const lowerName = name.toLowerCase();
  const ext = extension.toLowerCase();

  if (lowerName === "makefile" || lowerName.startsWith("makefile.") || ext === ".mk") {
    return <Hammer className={`${className} shrink-0 text-amber-300`} />;
  }
  if (ext === ".c" || ext === ".cpp" || ext === ".cc" || ext === ".cxx") {
    return <FileCode className={`${className} shrink-0 text-sky-300`} />;
  }
  if (ext === ".h" || ext === ".hpp") {
    return <FileCode2 className={`${className} shrink-0 text-violet-300`} />;
  }
  if (ext === ".s" || ext === ".asm") {
    return <Cpu className={`${className} shrink-0 text-emerald-300`} />;
  }
  if (ext === ".json" || ext === ".yaml" || ext === ".yml") {
    return <Braces className={`${className} shrink-0 text-yellow-200`} />;
  }
  if (ext === ".md" || ext === ".txt") {
    return <FileText className={`${className} shrink-0 text-[#F4F4F5]`} />;
  }

  return <File className={`${className} shrink-0 text-[#B4B4BC]`} />;
}
