export function tapFeedback(duration = 8): void {
  if ('vibrate' in navigator) {
    navigator.vibrate(duration);
  }
}
