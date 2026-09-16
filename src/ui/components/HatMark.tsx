/** Hatstand's top-hat mark, matching resources/hatstand.ico. */
export function HatMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7.2 5.6h9.6l-.7 6.8H7.9z" />
      <path d="M7.9 13.5h8.2v1.9H7.9z" />
      <rect x="3.8" y="15.4" width="16.4" height="2.6" rx="1.3" />
    </svg>
  );
}
