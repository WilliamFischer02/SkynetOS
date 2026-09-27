/**
 * The slug inside every id the app mints.
 *
 * `ph_<slug>` for a phantom, `u_<slug>`, `s_<slug>`, `f_<slug>`… for a node dropped in or made by
 * the factory: the name lower-cased, every run of anything but a letter or a digit folded into one
 * underscore, the ends trimmed, cut to 24 characters, and `node` when nothing is left. It was
 * written three times (phantoms, ingest, the node factory) before it lived here. The three must
 * agree: an approved phantom becomes a node on the same board, and its id must still be free.
 */
export function idSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'node';
}
