type ProductBrandInput = {
  name: string;
  category?: string;
  code?: string;
};

type BrandAsset = {
  label: string;
  domain: string;
  tone: string;
};

const brandAssets: Array<BrandAsset & { aliases: string[] }> = [
  { aliases: ["netflix", "net"], label: "Netflix", domain: "netflix.com", tone: "from-red-950 via-[#220406] to-black" },
  { aliases: ["spotify", "spo"], label: "Spotify", domain: "spotify.com", tone: "from-emerald-950 via-[#0e2119] to-black" },
  { aliases: ["wetv"], label: "WeTV", domain: "wetv.vip", tone: "from-cyan-950 via-slate-950 to-black" },
  { aliases: ["iqiyi"], label: "iQIYI", domain: "iq.com", tone: "from-emerald-900 via-slate-950 to-black" },
  { aliases: ["hbo", "max"], label: "HBO Max", domain: "max.com", tone: "from-purple-950 via-slate-950 to-black" },
  { aliases: ["crunchyroll", "crunchy"], label: "Crunchyroll", domain: "crunchyroll.com", tone: "from-orange-950 via-slate-950 to-black" },
  { aliases: ["youtube", "yt"], label: "YouTube", domain: "youtube.com", tone: "from-red-950 via-slate-950 to-black" },
  { aliases: ["disney"], label: "Disney+", domain: "disneyplus.com", tone: "from-sky-950 via-slate-950 to-black" },
  { aliases: ["bstation"], label: "Bstation", domain: "bilibili.tv", tone: "from-sky-900 via-slate-950 to-black" },
  { aliases: ["prime"], label: "Prime Video", domain: "primevideo.com", tone: "from-blue-950 via-slate-950 to-black" },
  { aliases: ["viu"], label: "Viu", domain: "viu.com", tone: "from-yellow-900 via-slate-950 to-black" },
  { aliases: ["loklok"], label: "Loklok", domain: "loklok.com", tone: "from-indigo-950 via-slate-950 to-black" },
  { aliases: ["apple tv", "atv"], label: "Apple TV", domain: "tv.apple.com", tone: "from-slate-950 via-zinc-900 to-black" },
  { aliases: ["apple music", "amusic"], label: "Apple Music", domain: "music.apple.com", tone: "from-pink-950 via-slate-950 to-black" },
  { aliases: ["tiktok"], label: "TikTok Music", domain: "music.tiktok.com", tone: "from-slate-950 via-zinc-900 to-black" },
  { aliases: ["picsart"], label: "Picsart", domain: "picsart.com", tone: "from-fuchsia-950 via-slate-950 to-black" },
  { aliases: ["capcut"], label: "CapCut", domain: "capcut.com", tone: "from-slate-950 via-zinc-900 to-black" },
  { aliases: ["canva"], label: "Canva", domain: "canva.com", tone: "from-cyan-950 via-blue-950 to-black" },
  { aliases: ["chatgpt", "gpt"], label: "ChatGPT", domain: "chatgpt.com", tone: "from-emerald-950 via-slate-950 to-black" },
  { aliases: ["getcontact"], label: "Getcontact", domain: "getcontact.com", tone: "from-sky-950 via-slate-950 to-black" },
  { aliases: ["inshot"], label: "InShot", domain: "inshot.com", tone: "from-rose-950 via-slate-950 to-black" },
  { aliases: ["alight"], label: "Alight Motion", domain: "alightmotion.com", tone: "from-emerald-950 via-slate-950 to-black" },
  { aliases: ["lightroom"], label: "Lightroom", domain: "adobe.com", tone: "from-sky-950 via-slate-950 to-black" },
  { aliases: ["remini"], label: "Remini", domain: "remini.ai", tone: "from-violet-950 via-slate-950 to-black" },
  { aliases: ["vsco"], label: "VSCO", domain: "vsco.co", tone: "from-zinc-950 via-slate-900 to-black" },
  { aliases: ["brainly"], label: "Brainly", domain: "brainly.com", tone: "from-emerald-950 via-slate-950 to-black" },
  { aliases: ["scribd"], label: "Scribd", domain: "scribd.com", tone: "from-emerald-950 via-slate-950 to-black" },
  { aliases: ["grammarly"], label: "Grammarly", domain: "grammarly.com", tone: "from-emerald-950 via-slate-950 to-black" },
  { aliases: ["microsoft", "ms365", "ms 365"], label: "Microsoft 365", domain: "microsoft.com", tone: "from-blue-950 via-slate-950 to-black" },
  { aliases: ["windscribe", "vpn"], label: "Windscribe", domain: "windscribe.com", tone: "from-sky-950 via-slate-950 to-black" },
];

function normalizeProductText(product: ProductBrandInput) {
  return [product.name, product.category, product.code].filter(Boolean).join(" ").toLowerCase();
}

export function productBrandAsset(product: ProductBrandInput): BrandAsset {
  const text = normalizeProductText(product);
  const match = brandAssets.find((asset) => asset.aliases.some((alias) => text.includes(alias)));
  if (match) {
    const { aliases: _aliases, ...asset } = match;
    return asset;
  }
  return {
    label: product.code || product.name || "Produk",
    domain: "",
    tone: "from-slate-950 via-zinc-900 to-black",
  };
}

export function productLogoUrl(product: ProductBrandInput) {
  const asset = productBrandAsset(product);
  if (!asset.domain) return "";
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(asset.domain)}&sz=128`;
}
