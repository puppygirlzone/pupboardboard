// Japanese wording for Aiko mode. Pure: translate(text) maps an English UI
// string to Japanese (exact phrases first, then patterns for counts and
// times). Names from your services (games, songs, films) are left alone.

const PHRASES = {
  // top bar and navigation
  Overview: '概要', Gaming: 'ゲーム', Music: '音楽', Media: 'メディア', News: 'ニュース', Films: '映画', 'Game deals': 'ゲームセール', Deals: 'セール',
  Settings: '設定', 'Colour theme': 'カラーテーマ', Hello: 'こんにちは', 'Connecting…': '接続中…', 'Server unreachable': 'サーバーに接続できません',
  'Good morning': 'おはようございます', 'Good afternoon': 'こんにちは', 'Good evening': 'こんばんは', 'Up late': '夜更かし中',
  '← Overview': '← 概要', 'More details': '詳細を見る', 'More details →': '詳細を見る →',
  // status pills
  Loading: '読み込み中', 'Loading…': '読み込み中…', 'Not set up': '未設定', Unavailable: '利用不可',
  // stats
  'Last 2 weeks': '過去2週間', 'Last 7 days': '過去7日間', 'hours played': 'プレイ時間', 'Games played': 'プレイしたゲーム', 'Games owned': '所有ゲーム数',
  'per Steam': 'Steam集計', 'All time': '累計', 'Tracks this week': '今週の再生曲数', 'Listening time': '再生時間', 'at least': '最低', 'this week': '今週',
  'at least, this week': '今週（最低）', 'Artists this week': '今週のアーティスト', 'top 5 shown': '上位5件', 'Top genre': 'トップジャンル', 'Top album': 'トップアルバム',
  'New movies': '新しい映画', 'New episodes': '新しいエピソード', Movies: '映画', Shows: '番組', Episodes: 'エピソード', 'in library': 'ライブラリ内',
  'Added this week': '今週の追加', 'movies + episodes': '映画＋エピソード', 'New today': '今日の新着', 'last 24 hours': '過去24時間', Feeds: 'フィード',
  'all reachable': 'すべて接続中', 'some unreachable': '一部接続できません', 'Free right now': '今だけ無料', 'PC games to keep': 'もらえるPCゲーム',
  'Best Steam sale': 'Steam最大割引', 'off right now': '割引中', 'Total worth': '合計金額', 'if you grabbed them all': '全部もらうと',
  'Steam sales': 'Steamセール', 'top rated deals': '高評価のセール', 'Best discount': '最大割引', 'Films this week': '今週の映画', 'This month': '今月',
  'Films this month': '今月の映画', 'last 30 days': '過去30日', 'Average rating': '平均評価', 'of rated films': '評価した映画', Liked: 'いいね', 'recent films': '最近の映画',
  'track lengths unknown': '曲の長さ不明',
  // headings
  'Now playing': '再生中', 'Top artists this week': '今週のトップアーティスト', 'Top albums this week': '今週のトップアルバム', 'Top genres this week': '今週のトップジャンル',
  'Recently played': '最近再生した曲', 'Most played songs (all time)': 'よく聴く曲（全期間）', 'Your top songs (last 4 weeks)': 'あなたのトップ曲（過去4週間）',
  'Recently played albums': '最近再生したアルバム', 'Most played albums': 'よく聴くアルバム', 'Recently added movies': '最近追加された映画',
  'Recently added episodes': '最近追加されたエピソード', 'Latest from all feeds': 'すべてのフィードの最新記事', 'Free to keep': '無料でもらえる',
  'Best Steam sales': 'Steamのおすすめセール', 'Recently watched': '最近観た映画', 'Other': 'その他', 'Top artist:': 'トップアーティスト：', 'Library:': 'ライブラリ：',
  // empty states
  'Nothing played recently.': '最近再生した曲はありません。', 'Play history unavailable.': '再生履歴を取得できません。', 'Nothing added recently.': '最近の追加はありません。',
  'No movies added recently.': '最近追加された映画はありません。', 'No episodes added recently.': '最近追加されたエピソードはありません。', 'No stories yet.': '記事はまだありません。',
  'No stories in this feed.': 'このフィードに記事はありません。', 'No games played in this period.': 'この期間にプレイしたゲームはありません。', 'No deals right now.': '現在セールはありません。',
  'No big sales right now.': '現在大きなセールはありません。', 'No films logged yet.': '記録された映画はまだありません。', 'Nothing yet this week.': '今週はまだありません。',
  'Retrying automatically.': '自動的に再試行します。', 'Something went wrong drawing this page.': 'ページの表示に失敗しました。', 'The next refresh will try again.': '次の更新で再試行します。',
  'Game details': 'ゲームの詳細', movies: '映画', shows: '番組', episodes: 'エピソード', 'Free': '無料', 'Steam News': 'Steamニュース',
};

const UNIT = { m: '分', h: '時間', d: '日', w: '週間', mo: 'か月', y: '年' };
const ago = (n, u) => `${n}${UNIT[u]}前`;

/** Patterns: [regex, (match) => Japanese]. Applied when no exact phrase matches. */
const PATTERNS = [
  [/^just now$/, () => 'たった今'],
  [/^(\d+)(mo|m|h|d|w|y) ago$/, (m) => ago(m[1], m[2])],
  [/^(Live|Partial|Offline) · (?:from )?(.+)$/, (m) => `${{ Live: 'ライブ', Partial: '一部', Offline: 'オフライン' }[m[1]]} · ${translate(m[2])}`],
  [/^Saved copy · (.+)$/, (m) => `保存済み · ${translate(m[1])}`],
  [/^(Updated|Fetched|Grated|Synced|更新) (.+)$/, (m) => `${translate(m[2])}に更新`],
  [/^\((\d+) tracks?\)$/, (m) => `（${m[1]}曲）`],
  [/^(\d+) tracks?$/, (m) => `${m[1]}曲`],
  [/^(\d+) plays?$/, (m) => `${m[1]}回再生`],
  [/^(\d+) new episodes?$/, (m) => `新しいエピソード${m[1]}件`],
  [/^New episode$/, () => '新しいエピソード'],
  [/^Playing (.+)$/, (m) => `${m[1]}をプレイ中`],
  [/^(\d+) days left$/, (m) => `残り${m[1]}日`],
  [/^ends today$/, () => '今日まで'],
  [/^ends tomorrow$/, () => '明日まで'],
  [/^worth \$(.+)$/, (m) => `$${m[1]}相当`],
  [/^average (.+)$/, (m) => `平均 ${m[1]}`],
  [/^(.+) isn't connected yet\.$/, (m) => `${translate(m[1])}はまだ接続されていません。`],
  [/^Couldn't reach (.+)\.$/, (m) => `${m[1]}に接続できませんでした。`],
  [/^Switch to (day|night) mode$/, (m) => (m[1] === 'day' ? '昼モードに切り替え' : '夜モードに切り替え')],
];

/** English UI text -> Japanese. Surrounding spaces are kept; unknown text comes back unchanged. */
export function translate(text) {
  const s = String(text ?? '');
  const core = s.trim();
  if (!core) return s;
  const lead = s.slice(0, s.indexOf(core));
  const tail = s.slice(s.indexOf(core) + core.length);
  if (Object.hasOwn(PHRASES, core)) return lead + PHRASES[core] + tail;
  for (const [re, fn] of PATTERNS) {
    const m = core.match(re);
    if (m) return lead + fn(m) + tail;
  }
  // "2000 · 7h ago", " movies · ": translate each part around the dots.
  if (core.includes('·')) {
    const parts = core.split(/(\s*·\s*)/);
    const done = parts.map((p) => (/^\s*·\s*$/.test(p) || !p ? p : translate(p)));
    if (done.some((p, i) => p !== parts[i])) return lead + done.join('') + tail;
  }
  return s;
}

/** Every Japanese character the translations can produce (used to build the font subset). */
export function japaneseCharacters(extra = '') {
  const all = Object.values(PHRASES).join('') + Object.values(UNIT).join('') + PATTERNS.map(([, fn]) => fn.toString()).join('') + extra;
  return [...new Set(all)].filter((c) => c.charCodeAt(0) > 0x2000).join('');
}
