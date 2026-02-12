export function emitOutput<T>(
  payload: T,
  asJson: boolean,
  formatText: (value: T) => string
) {
  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(formatText(payload));
}
