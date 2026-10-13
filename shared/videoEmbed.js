/** Convert known provider page URLs to their fixed HTTPS player origins. */
export function videoEmbedUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    const host = url.hostname.toLowerCase();
    if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtube-nocookie.com"].includes(host)) {
      const id = host === "youtu.be" ? url.pathname.slice(1).split("/")[0]
        : url.pathname === "/watch" ? url.searchParams.get("v")
        : /^\/(?:embed|shorts|live)\//.test(url.pathname) ? url.pathname.split("/")[2] : "";
      return /^[A-Za-z0-9_-]{11}$/.test(id || "") ? `https://www.youtube-nocookie.com/embed/${id}` : "";
    }
    if (["vimeo.com", "www.vimeo.com", "player.vimeo.com"].includes(host)) {
      const match = url.pathname.match(/(?:^\/|\/video\/)(\d+)\/?$/);
      if (!match) return "";
      const player = new URL(`https://player.vimeo.com/video/${match[1]}`);
      if (/^[a-f0-9]+$/i.test(url.searchParams.get("h") || "")) player.searchParams.set("h", url.searchParams.get("h"));
      return player.href;
    }
    return "";
  } catch { return ""; }
}
