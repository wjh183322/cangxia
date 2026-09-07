export async function notifyWechat({ title, content, pushplusToken, wxpusherSpt }) {
  const sent = [];
  if (pushplusToken) {
    try {
      const res = await fetch("https://www.pushplus.plus/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: pushplusToken, title, content }),
      });
      sent.push({ channel: "pushplus", ok: res.ok });
    } catch (err) {
      sent.push({ channel: "pushplus", ok: false, error: String(err) });
    }
  }
  if (wxpusherSpt) {
    try {
      const res = await fetch("https://wxpusher.zjiecode.com/api/send/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appToken: wxpusherSpt,
          content,
          summary: title,
          contentType: 1,
          spt: wxpusherSpt,
        }),
      });
      sent.push({ channel: "wxpusher", ok: res.ok });
    } catch (err) {
      sent.push({ channel: "wxpusher", ok: false, error: String(err) });
    }
  }
  return sent;
}
