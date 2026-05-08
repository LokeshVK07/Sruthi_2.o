type AppLogoProps = {
  size?: number;
  className?: string;
};

/**
 * Renders the bundled Vibe 2.o app icon (apps/web/public/Icon.png) at the
 * given pixel size. Re-uses the existing public asset so the brand mark stays
 * consistent across favicon, install icon, and in-app header.
 */
export default function AppLogo({ size = 36, className }: AppLogoProps) {
  return (
    <img
      src="/Icon.png"
      width={size}
      height={size}
      alt="Vibe 2.o"
      className={className}
      style={{ borderRadius: size * 0.28, flex: "0 0 auto" }}
    />
  );
}
