import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      [
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "https://*.clerk.accounts.dev https://*.clerk.com https://clerk.com",
        "https://clerk.foundr1.jp https://accounts.foundr1.jp",
        "https://challenges.cloudflare.com https://hcaptcha.com https://*.hcaptcha.com",
        "https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/"
      ].join(" "),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https:",
      [
        "frame-src 'self'",
        "https://*.clerk.accounts.dev https://*.clerk.com https://clerk.com",
        "https://clerk.foundr1.jp https://accounts.foundr1.jp",
        "https://challenges.cloudflare.com https://hcaptcha.com https://*.hcaptcha.com",
        "https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/"
      ].join(" "),
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'"
    ].join("; ")
  },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self)" }
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["@sparticuz/chromium"],
  outputFileTracingIncludes: {
    "/api/public/orders/receipt/preview-pdf": [
      "./node_modules/@sparticuz/chromium/bin/**/*",
      "./fonts/**/*",
      "./app/globals.css",
      "./public/brands/*.png"
    ],
    "/api/public/orders/receipt/pdf/[filename]": [
      "./node_modules/@sparticuz/chromium/bin/**/*",
      "./fonts/**/*",
      "./app/globals.css",
      "./public/brands/*.png"
    ]
  },
  outputFileTracingExcludes: {
    "/api/public/orders/receipt/preview-pdf": [
      "./public/downloads/**/*",
      "./Foundr1Android/**/*",
      "./output/**/*",
      "./outputs/**/*"
    ],
    "/api/public/orders/receipt/pdf/[filename]": [
      "./public/downloads/**/*",
      "./Foundr1Android/**/*",
      "./output/**/*",
      "./outputs/**/*"
    ]
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders
      }
    ];
  }
};

export default nextConfig;
