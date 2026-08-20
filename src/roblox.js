const { requestWithRetry } = require('./httpClient');
const config = require('./config');

const ROBLOX_API_KEY_HEADER = { 'x-api-key': config.robloxApiKey };

// Logika ini sengaja disamakan persis dengan bot "kokokrunch-eligible-bot" yang
// sudah berjalan (Open Cloud Memberships API sebagai PRIMARY, legacy audit-log
// sebagai FALLBACK), supaya hasil cek eligibility konsisten di semua bot.

async function resolveUsername(username) {
  const res = await requestWithRetry(
    {
      method: 'POST',
      url: 'https://users.roblox.com/v1/usernames/users',
      data: { usernames: [username], excludeBannedUsers: false },
      headers: { 'Content-Type': 'application/json' },
    },
    { context: 'users.roblox.com (resolve username)' }
  );

  const found = res.data?.data?.[0];
  if (!found) return null;
  return { userId: found.id, username: found.name, displayName: found.displayName };
}

async function getAvatarUrl(userId) {
  try {
    const res = await requestWithRetry(
      {
        method: 'GET',
        url: 'https://thumbnails.roblox.com/v1/users/avatar',
        params: { userIds: userId, size: '250x250', format: 'Png', isCircular: false },
      },
      { context: 'thumbnails.roblox.com (avatar)' }
    );
    return res.data?.data?.[0]?.imageUrl ?? null;
  } catch (err) {
    console.warn('[Roblox] Gagal ambil avatar.', err.message);
    return null;
  }
}

async function getMembershipViaOpenCloud(userId) {
  try {
    const res = await requestWithRetry(
      {
        method: 'GET',
        url: `https://apis.roblox.com/cloud/v2/groups/${config.robloxGroupId}/memberships`,
        headers: ROBLOX_API_KEY_HEADER,
        params: { maxPageSize: 1, filter: `user == 'users/${userId}'` },
      },
      { context: 'apis.roblox.com (list memberships, filtered)' }
    );
    const membership = res.data?.groupMemberships?.[0];
    if (membership?.createTime) {
      return { isMember: true, joinDate: new Date(membership.createTime) };
    }
    return { isMember: false, joinDate: null };
  } catch (err) {
    const status = err.response?.status;
    if (status !== 400) throw err;
    console.warn('[Roblox] Filter query tidak didukung, fallback ke pagination manual...');
    return getMembershipViaPagination(userId);
  }
}

async function getMembershipViaPagination(userId) {
  let pageToken = undefined;
  const targetPath = `users/${userId}`;
  const MAX_PAGES = 50;

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await requestWithRetry(
      {
        method: 'GET',
        url: `https://apis.roblox.com/cloud/v2/groups/${config.robloxGroupId}/memberships`,
        headers: ROBLOX_API_KEY_HEADER,
        params: { maxPageSize: 100, pageToken },
      },
      { context: `apis.roblox.com (list memberships, page ${page + 1})` }
    );
    const memberships = res.data?.groupMemberships ?? [];
    const found = memberships.find((m) => m.user === targetPath);
    if (found) return { isMember: true, joinDate: new Date(found.createTime) };
    pageToken = res.data?.nextPageToken;
    if (!pageToken) break;
  }
  return { isMember: false, joinDate: null };
}

async function getJoinDateViaAuditLog(userId) {
  const res = await requestWithRetry(
    {
      method: 'GET',
      url: `https://apis.roblox.com/legacy-groups/v1/groups/${config.robloxGroupId}/audit-log`,
      headers: ROBLOX_API_KEY_HEADER,
      params: { actionType: 'JoinGroup', userId, limit: 10, sortOrder: 'Desc' },
    },
    { context: 'apis.roblox.com (legacy audit-log fallback)', retries: 2 }
  );
  const entries = res.data?.data ?? [];
  const entry = entries.find((e) => String(e.actor?.user?.userId) === String(userId));
  if (!entry) return { isMember: false, joinDate: null };
  return { isMember: true, joinDate: new Date(entry.created) };
}

async function checkMembership(userId) {
  try {
    return await getMembershipViaOpenCloud(userId);
  } catch (primaryErr) {
    console.warn('[Roblox] Primary membership check gagal, coba fallback audit-log...', primaryErr.message);
    try {
      return await getJoinDateViaAuditLog(userId);
    } catch (fallbackErr) {
      console.error('[Roblox] Fallback audit-log juga gagal.', fallbackErr.message);
      throw primaryErr;
    }
  }
}

/**
 * Cek membership + syarat hari gabung untuk userId yang SUDAH di-resolve
 * sebelumnya (dipisah dari checkEligibility supaya bisa dipanggil belakangan,
 * setelah user konfirmasi "Yes, ini akun saya").
 *
 * @returns {Promise<
 *   | { status: 'not_member' }
 *   | { status: 'not_eligible', joinDate: Date, daysSinceJoin: number }
 *   | { status: 'eligible', joinDate: Date }
 * >}
 */
async function evaluateMembershipEligibility(userId) {
  const membership = await checkMembership(userId);

  if (!membership.isMember) {
    return { status: 'not_member' };
  }

  const daysSinceJoin = (Date.now() - membership.joinDate.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceJoin < config.eligibleDays) {
    return { status: 'not_eligible', joinDate: membership.joinDate, daysSinceJoin };
  }

  return { status: 'eligible', joinDate: membership.joinDate };
}

/**
 * Fungsi utama dipakai oleh alur order: resolve username lalu cek eligibility
 * dalam satu panggilan. Mengembalikan status yang jelas supaya pemanggil (modal
 * handler) tinggal cabang if/else tanpa perlu tahu detail Roblox API.
 *
 * @returns {Promise<
 *   | { status: 'not_found' }
 *   | { status: 'not_member', username: string, avatarUrl: string|null }
 *   | { status: 'not_eligible', username: string, avatarUrl: string|null, joinDate: Date, daysSinceJoin: number }
 *   | { status: 'eligible', username: string, userId: number, avatarUrl: string|null, joinDate: Date }
 * >}
 */
async function checkEligibility(inputUsername) {
  const resolved = await resolveUsername(inputUsername);
  if (!resolved) return { status: 'not_found' };

  const [avatarUrl, evaluation] = await Promise.all([
    getAvatarUrl(resolved.userId),
    evaluateMembershipEligibility(resolved.userId),
  ]);

  return { ...evaluation, username: resolved.username, userId: resolved.userId, avatarUrl };
}

module.exports = { resolveUsername, getAvatarUrl, checkMembership, evaluateMembershipEligibility, checkEligibility };
