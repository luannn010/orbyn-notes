import {
  getSchema,
  type Extensions,
  type NodeViewRenderer,
} from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { safeHref } from "../domain/validation";
import { createNoteLinkExtension } from "./noteLink";

function allowedUri(value: string): boolean {
  if (!safeHref(value)) return false;
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** Identical configuration for the real editor and headless persisted-step verification. */
export function createNoteExtensions(
  options: { noteLinkNodeView?: NodeViewRenderer } = {},
): Extensions {
  return [
    StarterKit.configure({
      trailingNode: false,
      link: { openOnClick: false, autolink: false, isAllowedUri: allowedUri },
    }),
    TaskList.configure({}),
    TaskItem.configure({ nested: true }),
    createNoteLinkExtension({ nodeView: options.noteLinkNodeView }),
  ];
}
export function createNoteSchema(): Schema {
  return getSchema(createNoteExtensions());
}
