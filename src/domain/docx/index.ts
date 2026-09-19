/**
 * DOCX export domain (F1-6).
 *
 * Only the manifest is re-exported here. `./serialize` imports the `docx`
 * package statically, and a barrel that pulled it in would defeat the whole
 * point of the dynamic import in `@/lib/docx/export`: anything importing the
 * manifest for a label or a count would drag the packer into the bundle with
 * it. Import `./serialize` by its own path, from code that is already lazy.
 */
export * from "./manifest";
export * from "./labels";
