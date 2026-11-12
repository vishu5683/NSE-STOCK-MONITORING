// Tiny reader for the Upstox V3 feed frames we care about: last price and previous close.
// Schema: server/MarketDataFeedV3.proto. Unknown fields are skipped.

const utf8 = new TextDecoder();

function readVarint(buf, o) {
  let result = 0;
  let shift = 0;
  while (o.i < buf.length) {
    const b = buf[o.i++];
    result += (b & 0x7f) * 2 ** shift;
    if ((b & 0x80) === 0) return result;
    shift += 7;
    if (shift > 56) break;
  }
  return result;
}

function skip(buf, o, wire) {
  if (wire === 0) readVarint(buf, o);
  else if (wire === 1) o.i += 8;
  else if (wire === 5) o.i += 4;
  else if (wire === 2) {
    // read the length first: `o.i += readVarint()` would use the position from before the length bytes
    const len = readVarint(buf, o);
    o.i += len;
  }
  else throw new Error('Unknown protobuf wire type');
}

function readDouble(buf, o) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getFloat64(o.i, true);
  o.i += 8;
  return v;
}

function parseUntil(buf, o, limit, onField) {
  while (o.i < limit) {
    const tag = readVarint(buf, o);
    const field = tag >>> 3;
    const wire = tag & 7;
    const used = onField(field, wire);
    if (!used) skip(buf, o, wire);
  }
  if (o.i > limit) o.i = limit;
}

function parseLtpc(buf, o, limit) {
  const out = {};
  parseUntil(buf, o, limit, (field, wire) => {
    if (field === 1 && wire === 1) {
      out.ltp = readDouble(buf, o);
      return true;
    }
    if (field === 4 && wire === 1) {
      out.cp = readDouble(buf, o);
      return true;
    }
    return false;
  });
  return out;
}

function parseMessage(buf, o, limit, onField) {
  parseUntil(buf, o, limit, onField);
}

export function decodeFeed(buffer) {
  // Uint8Array in the browser, Buffer (a Uint8Array) in Node
  const buf = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const o = { i: 0 };
  const feeds = {};
  let currentTs = 0;
  parseMessage(buf, o, buf.length, (field, wire) => {
    if (field === 2 && wire === 2) {
      const entryLen = readVarint(buf, o);
      const entryEnd = o.i + entryLen;
      let key = '';
      let ltpc = null;
      parseMessage(buf, o, entryEnd, (f, w) => {
        if (f === 1 && w === 2) {
          const len = readVarint(buf, o);
          key = utf8.decode(buf.subarray(o.i, o.i + len));
          o.i += len;
          return true;
        }
        if (f === 2 && w === 2) {
          const feedLen = readVarint(buf, o);
          const feedEnd = o.i + feedLen;
          parseMessage(buf, o, feedEnd, (ff, ww) => {
            if (ff === 1 && ww === 2) {
              const ltpcLen = readVarint(buf, o);
              const ltpcEnd = o.i + ltpcLen;
              ltpc = parseLtpc(buf, o, ltpcEnd);
              return true;
            }
            return false;
          });
          return true;
        }
        return false;
      });
      if (key) feeds[key] = { ltpc: ltpc || {} };
      return true;
    }
    if (field === 3 && wire === 0) {
      currentTs = readVarint(buf, o);
      return true;
    }
    return false;
  });
  return { feeds, currentTs };
}
