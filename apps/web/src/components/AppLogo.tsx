type AppLogoProps = {
  size?: number;
  className?: string;
};

/**
 * Renders the bundled ViBe artwork at the given pixel size. Re-uses the
 * existing public asset so the brand mark stays consistent across favicon,
 * install icon, and in-app header.
 */
export default function AppLogo({ size = 36, className }: AppLogoProps) {
  return (
    <img
      src="/Sruthi_kutty.jpg"
      width={size}
      height={size}
      alt="ViBe 2.o"
      className={className}
      style={{ borderRadius: size * 0.28, flex: "0 0 auto" }}
    />
  );
}
