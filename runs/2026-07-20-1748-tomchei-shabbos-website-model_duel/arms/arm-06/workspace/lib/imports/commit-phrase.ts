// G-029: the typed-phrase confirmation for import commit. The phrase is
// derived from the staged batch's dry-run summary (its valid-row count), so
// typing it proves the operator read the verdict ledger before anything
// writes. Server and preview UI share this one formula — dependency-free so
// the client bundle can import it.
export function expectedCommitPhrase(validRows: number): string {
  return `commit ${validRows} row${validRows === 1 ? "" : "s"}`;
}
