// The plain words the session pop-up uses: names for measurements, events, senders, levels and
// endings, and what each table column means. Kept together so every part says them the same way.
import { utcTime } from "../lib/format";

// Every measurement the player app sends: [name with the app's field name, unit, what it is].
// The names match the main page's cards. Checked in the data: readings are 1,000 ms apart,
// 10 per batch, and none is a running total (each goes up and down). Units are read from the
// value ranges; exact definitions live in the player app's code, so anything not checked says so.
export const MEASUREMENTS = {
  fps: [
    "Frames per second (fps)",
    "",
    "Video frames in that second, as the player app reports them. Always a whole number. 30 is the idle rate.",
  ],
  latency: [
    "Latency (latency)",
    "ms",
    "Delay between player and host in that second, as the app reports it. Whether it is one way or the round trip is not documented.",
  ],
  jitter: [
    "Jitter (jitter)",
    "ms",
    "How much the delay varied in that second, as the app reports it.",
  ],
  bitrate: ["Bitrate (bitrate)", "Mbps", "Video data received in that second."],
  downloadSpeed: [
    "Download speed (downloadSpeed)",
    "Mbps",
    "The player's download speed in that second, as the app measures it.",
  ],
  decodeDuration: [
    "Decode time (decodeDuration)",
    "ms",
    "How long the player took to decode a frame, in that second.",
  ],
  encodeDuration: [
    "Encode time (encodeDuration)",
    "ms",
    "How long the host took to encode a frame, in that second.",
  ],
  skippedFrames: [
    "Skipped frames (skippedFrames)",
    "",
    "Frames skipped (not shown) in that second. A count for that second, not a running total.",
  ],
  accumulatedFrames: [
    "Accumulated frames (accumulatedFrames)",
    "",
    "The app's own measure; its exact meaning is not documented. Not a running total and often a fraction, so likely an average within the second. Around 1 is typical in this data.",
  ],
};

// A measurement's table heading: its name, then its unit, e.g. "Latency (latency), ms".
export function heading(name) {
  const [title, unit] = MEASUREMENTS[name] || [name, ""];
  return unit ? `${title}, ${unit}` : title;
}

// Access modes from client_connected, in plain words.
export const WHO = {
  external: "External user",
  external_session: "External user",
  owner: "Owner",
  share: "Share link",
};

// Plain names for the events a founder is most likely to see. The raw name stays underneath.
const EVENTS = {
  "pipeline.connect.attempt": "Tried to connect",
  "pipeline.connect.success": "Connected, video started",
  "pipeline.connect.failure": "Connection error",
  "pipeline.connection.dropped": "Connection dropped",
  "media.decode.error": "Video could not be decoded",
  "ice.connection.state": "Network path changed",
  "media.first_decode": "First video frame",
  "webrtc.connection.state": "Video connection changed",
  "ice.candidate.error": "One network path failed (usually harmless)",
  "ice.gathering.complete": "Network paths found",
  "ice.restart": "Network path restarted",
  "ws.connect": "Connection channel opened",
  "ws.disconnect": "Connection channel lost",
  "ws.reconnect.attempt": "Connection channel retry",
  "ws.reconnect.success": "Connection channel restored",
  "ws.reconnect.exhausted": "Connection channel gave up retrying",
  ws_error: "Connection channel error",
  session_started: "Session started",
  session_ended: "Session ended",
  client_connected: "Player joined",
  client_disconnected: "Player left",
  client_reconnected: "Player rejoined",
  host_connected: "Host joined",
  host_disconnected: "Host left",
};

// Plain words for the server's names: who sent an event, how serious it is and a connection's role.
export const WHO_SENT = {
  client: "player app",
  host: "host",
  system: "server",
};
export const LEVELS = { error: "Error", warn: "Warning", info: "Normal" };
export const ROLES = { client: "player", host: "host" };

// A server list such as "client, host" in plain words. Names that read the same show once
// (external and external_session are both "External user").
export function plain(names, words) {
  if (!names) return "—";
  const plainNames = names.split(", ").map((name) => words[name] || name);
  return [...new Set(plainNames)].join(", ");
}

// An event's plain name. The app's own event name is used when it sent one, otherwise the
// server's event type; a name with no plain wording yet shows exactly as sent.
export function eventName(e) {
  const name = e.pipeline_event || e.event_type;
  return EVENTS[name] || name;
}

// Times show as HH:MM:SS (UTC) when they all fall on one day, and with the date otherwise.
export function clock(values) {
  const days = new Set(values.map((value) => utcTime(value).split(",")[0]));
  const day = days.size === 1 ? [...days][0] : null;
  return {
    day,
    time: (value) =>
      day ? utcTime(value, true).split(", ")[1] : utcTime(value, true),
  };
}

// What each column of the connections table means, shown by its "i" button.
export const CONNECTION_NOTES = {
  Connection:
    'The ID the app gives each connection. A player who leaves and rejoins gets a new one, so one person can have several rows. "Not tied to a connection" holds events sent before a connection existed, such as connect tries.',
  Role: "Whether this connection is the host (the gaming machine) or a player.",
  "Sent by":
    "Which side logged these events: the server, the player app or the host.",
  "First event": "Time of this connection's first event (UTC).",
  "Last event": "Time of this connection's last event (UTC).",
  Attempts: "How many times the app tried to connect.",
  Connected: "How many of those tries connected and started video.",
  "Connection errors":
    "Connection errors the app reported. This can be more than the attempts: one try can report more than one error, and the app sometimes keeps retrying after the session has already closed.",
  Disconnects: "How many times the player left.",
  Reconnects: "How many times the player came back.",
};
// The same for the stream quality summary table.
export const PERFORMANCE_NOTES = {
  Measurement:
    "What the player app measured, with the app's own field name in brackets and its unit. Units are read from the value ranges; the team should confirm them.",
  Average:
    "The mean: add up every reading and divide by how many there are. One reading per second, for the whole session. If two players report in the same second, both readings count; that is rare (about 0.03% of seconds).",
  Lowest: "The lowest single reading, so the worst or best one second.",
  Highest: "The highest single reading, so the worst or best one second.",
  "Seconds measured":
    "How many readings were used. Readings are 1 second apart, so 60 is one minute of streaming.",
  "Seconds with no value":
    "Seconds where the value was empty or not a usable number. They are left out of the average.",
};
// The same for the event list.
export const EVENT_NOTES = {
  "What happened":
    "What happened, in plain words. Underneath: the app's own text in quotes, then the code, stage, phase and any state change, exactly as sent.",
  "App's event name": "The name the app itself gives this event.",
  Level:
    "Error: something failed. Warning: something went wrong but may have recovered. Normal: everyday activity.",
  "Sent by":
    "Which side logged the event: the server, the player app or the host.",
  Connection: "The connection the event belongs to, if any.",
  "Message from the app":
    "The event exactly as the app sent it, unchanged: its message and every field.",
};

// How the server says a session ended, in plain words. The app's own value shows in technical details.
export const ENDINGS = {
  "Device deleted": "gaming server removed",
  "Not in use": "closed while not in use",
  "Ended by user": "ended by the user",
};
