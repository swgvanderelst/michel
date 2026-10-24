// Generates database.rules.json (kept as a script so the long expressions stay readable).
// dev-server.mjs must enforce exactly the same permissions; test/parity.test.js checks that.
import fs from 'node:fs';

const KEY = '/^[-_A-Za-z0-9]{1,32}$/'; // every client-chosen key/id/uid: safe to put in HTML attributes
const TOKEN = '/^[A-Za-z0-9]{10,32}$/'; // join tokens: 12 random chars, never typed
const P = "root.child('parties').child($pid)"; // old state of this party
const OPEN = `!${P}.child('closedAt').exists()`;
const ADMIN = `auth.uid === ${P}.child('admin').val()`;
const NEWPARTY = 'newData.parent().parent()'; // from claims/$x, members/$x: the party after this write
const TIME = 'newData.isNumber() && newData.val() > 0 && newData.val() <= now + 300000'; // rules `now` is server time
const DOSE_FIELDS = "['friendId', 'size', 't', 'addedAt']";
const claimOf = fid => `${P}.child('claims').child(${fid}).val() === auth.uid`;

// codes/$code: newData.parent().parent() is the root after the write
const NR = 'newData.parent().parent()';
const CODE_PARTY = `${NR}.child('parties').child(newData.val())`;

const rules = {
  rules: {
    // allow-listed creators: set manually in the console, never readable or writable by clients
    creators: { '.read': false, '.write': false },
    codes: {
      // direct get allowed, no listing: no .read on "codes" itself
      $code: {
        '.read': 'auth != null',
        '.write': 'auth != null && ('
          // create: free code, for a party I administer, and the party lists it too
          + `(!data.exists() && newData.isString() && ${CODE_PARTY}.child('admin').val() === auth.uid && !${CODE_PARTY}.child('closedAt').exists() && ${CODE_PARTY}.child('codes').child($code).exists())`
          // delete: admin (also after closing), together with the party's own entry
          + " || (data.exists() && !newData.exists() && root.child('parties').child(data.val()).child('admin').val() === auth.uid"
          + ` && !${NR}.child('parties').child(data.val()).child('codes').child($code).exists()))`,
        '.validate': `$code.matches(${TOKEN}) && newData.isString() && newData.val().matches(${KEY})`,
      },
    },
    parties: {
      // no .read here: parties cannot be listed
      $pid: {
        '.read': 'auth != null',
        '.write': "auth != null && !data.exists() && root.child('creators').child(auth.uid).val() === true && newData.child('admin').val() === auth.uid",
        '.validate': `$pid.matches(${KEY}) && newData.hasChildren(['name', 'admin', 'createdAt'])`
          + " && (data.exists() || (!newData.child('claims').exists() && !newData.child('members').exists() && !newData.child('doses').exists() && !newData.child('closedAt').exists()))",
        name: { '.validate': 'newData.isString() && newData.val().length >= 1 && newData.val().length <= 30' },
        admin: { '.validate': 'newData.val() === auth.uid' },
        createdAt: { '.validate': TIME },
        closedAt: {
          '.write': "auth != null && auth.uid === data.parent().child('admin').val() && !data.exists()",
          '.validate': TIME,
        },
        codes: {
          $c: {
            // create only while open; delete also after closing, but only together with the root codes/$c
            '.write': `auth != null && ${ADMIN} && (${OPEN} || !newData.exists()) && (newData.exists() || !newData.parent().parent().parent().parent().child('codes').child($c).exists())`,
            // must pair with codes/$c -> this party (checked on the data after the write)
            '.validate': `$c.matches(${TOKEN}) && newData.isNumber() && newData.val() >= 0 && newData.val() <= now + 300000 && newData.parent().parent().parent().parent().child('codes').child($c).val() === $pid`,
          },
        },
        friends: {
          $fid: {
            // admin only: add, rename, max, remove; a friend must stay complete
            '.write': `auth != null && ${ADMIN} && ${OPEN} && (!newData.exists() || newData.hasChildren(['name', 'createdAt']))`,
            '.validate': `$fid.matches(${KEY}) && newData.hasChildren(['name', 'createdAt'])`,
            name: { '.validate': 'newData.isString() && newData.val().length >= 1 && newData.val().length <= 14' },
            createdAt: { '.validate': TIME },
            max: { '.validate': 'newData.isNumber() && newData.val() >= 0.25 && newData.val() <= 20 && newData.val() % 0.25 === 0' },
            $other: { '.validate': false },
          },
        },
        doses: {
          $did: {
            // the dose must stay complete (no deleting single fields); old AND new friendId must be the caller's own (admin: any)
            '.write': `auth != null && ${OPEN} && (!newData.exists() || newData.hasChildren(${DOSE_FIELDS}))`
              + ` && (${ADMIN} || ((!data.exists() || ${claimOf("data.child('friendId').val()")}) && (!newData.exists() || ${claimOf("newData.child('friendId').val()")})))`,
            '.validate': `$did.matches(${KEY}) && newData.hasChildren(${DOSE_FIELDS})`,
            friendId: { '.validate': `newData.isString() && newData.val().matches(${KEY}) && newData.parent().parent().parent().child('friends').child(newData.val()).exists() && (!data.exists() || data.val() === newData.val())` },
            size: { '.validate': '(newData.val() === 1 || newData.val() === 0.5 || newData.val() === 0.25) && (!data.exists() || data.val() === newData.val())' },
            t: { '.validate': TIME },
            addedAt: { '.validate': `${TIME} && (!data.exists() || data.val() === newData.val())` },
            $other: { '.validate': false },
          },
        },
        claims: {
          $fid: {
            // claims and members always change together (claims/$fid = uid, members/$uid = $fid)
            '.write': `auth != null && ${OPEN} && ((${ADMIN} && data.exists() && !newData.exists() && !${NEWPARTY}.child('members').child(data.val()).exists())`
              + ` || (!data.exists() && newData.val() === auth.uid && !data.parent().parent().child('members').child(auth.uid).exists() && ${NEWPARTY}.child('members').child(auth.uid).val() === $fid)`
              + ` || (data.exists() && !newData.exists() && data.val() === auth.uid && !${NEWPARTY}.child('members').child(auth.uid).exists()))`,
            '.validate': `$fid.matches(${KEY}) && newData.isString() && newData.val().matches(${KEY}) && newData.parent().parent().child('friends').child($fid).exists()`,
          },
        },
        members: {
          $uid: {
            '.write': `auth != null && ${OPEN} && ((${ADMIN} && data.exists() && !newData.exists() && !${NEWPARTY}.child('claims').child(data.val()).exists())`
              + ` || ($uid === auth.uid && ((!data.exists() && newData.isString() && ${NEWPARTY}.child('claims').child(newData.val()).val() === auth.uid)`
              + ` || (data.exists() && !newData.exists() && !${NEWPARTY}.child('claims').child(data.val()).exists()))))`,
            '.validate': `$uid.matches(${KEY}) && newData.isString() && newData.val().matches(${KEY})`,
          },
        },
        $other: { '.validate': false },
      },
    },
  },
};
fs.writeFileSync(new URL('../database.rules.json', import.meta.url), JSON.stringify(rules, null, 2) + '\n');
