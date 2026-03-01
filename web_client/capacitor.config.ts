import "dotenv/config"
import type { CapacitorConfig } from "@capacitor/cli"

const config: CapacitorConfig = {
  appId: "com.irvinehacks.app",
  appName: "Irvine Hacks",
  webDir: "dist",
  plugins: {
    StatusBar: {
      overlaysWebView: true,
      style: "DARK",
    },
    SocialLogin: {
      providers: {
        google: true,
        facebook: false,
        apple: false,
        twitter: false,
      },
      logLevel: 1,
    },
  },
}

export default config
