/** Groupe de capture garanti par l'expression : lève si le contrat de l'expression est rompu. */
export function group(m: RegExpExecArray, index: number): string {
  const value = m[index];
  if (value === undefined) {
    throw new Error(`groupe de capture ${String(index)} absent dans « ${m[0]} »`);
  }
  return value;
}
