export function renderRelaySubmissionStatus(options: {
  heading: string;
  message: string;
  busy?: boolean;
  retryLabel?: string;
  onRetry?: () => void;
  onBack: () => void;
}): HTMLElement {
  const section = document.createElement('section');
  section.className = 'relay-screen relay-submission-status';
  section.setAttribute('aria-busy', options.busy ? 'true' : 'false');
  const kicker = document.createElement('p');
  kicker.className = 'relay-kicker';
  kicker.textContent = 'COMPETITIVE PROOF';
  const heading = document.createElement('h1');
  heading.textContent = options.heading;
  const message = document.createElement('p');
  message.className = 'relay-lead';
  message.setAttribute('role', 'status');
  message.textContent = options.message;
  section.append(kicker, heading, message);
  if (options.onRetry) {
    const retry = document.createElement('button');
    retry.className = 'relay-primary';
    retry.type = 'button';
    retry.textContent = options.retryLabel ?? 'Retry submission';
    retry.addEventListener('click', options.onRetry);
    section.append(retry);
  }
  const back = document.createElement('button');
  back.className = 'relay-secondary';
  back.type = 'button';
  back.textContent = 'Keep practice result';
  back.addEventListener('click', options.onBack);
  section.append(back);
  return section;
}
