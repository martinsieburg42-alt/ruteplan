/* Ruten pakkes komprimeret ind i selve linket (efter #), så den kan sendes til en telefon
   uden login og uden server. Delen efter # sendes aldrig til GitHub – den bliver på telefonen.
   Format "1" + base64url(deflate-raw(JSON)). Kræver pako (vendor/pako*.min.js). */
var PlanLink = (function () {
  function b64u(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64u(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/'); while (str.length % 4) str += '=';
    var bin = atob(str), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function encode(plan) { return '1' + b64u(pako.deflateRaw(JSON.stringify(plan), { level: 9 })); }
  function decode(str) {
    str = String(str || '').replace(/^#/, '').replace(/^p=/, '').trim();
    if (str.charAt(0) !== '1') throw new Error('format');
    return JSON.parse(pako.inflateRaw(unb64u(str.slice(1)), { to: 'string' }));
  }
  return { encode: encode, decode: decode };
})();
if (typeof module !== 'undefined') module.exports = PlanLink;
