/** Знак приложения: скруглённый квадрат с «облаком» сообщения. */
export default function Logo({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <rect width="48" height="48" rx="12" fill="var(--accent)" />
      <path
        d="M14 15.5h20a4 4 0 0 1 4 4v9a4 4 0 0 1-4 4H22l-6.5 5v-5H14a4 4 0 0 1-4-4v-9a4 4 0 0 1 4-4Z"
        fill="var(--accent-fg)"
      />
      <circle cx="18" cy="24" r="2" fill="var(--accent)" />
      <circle cx="24" cy="24" r="2" fill="var(--accent)" />
      <circle cx="30" cy="24" r="2" fill="var(--accent)" />
    </svg>
  );
}
