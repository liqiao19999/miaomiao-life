/* ============================================================
 * data.js — 数据访问层
 * ------------------------------------------------------------
 * 本 App 不内置任何演示商品。所有商品与价格均由用户手动录入，
 * 保存在浏览器本地（localStorage）。
 * 如需接入真实数据源，改写 dataSource.fetchRemote() 返回相同结构即可，
 * UI 层无需改动。
 * ============================================================ */

(function (global) {
  'use strict';

  // 平台品牌信息（配色、简称、跳转域名）
  const PLATFORMS = {
    jd:       { name: '京东',       short: '京', color: '#e1251b', domain: 'search.jd.com' },
    tmall:    { name: '天猫',       short: '猫', color: '#ff0036', domain: 'list.tmall.com' },
    pdd:      { name: '拼多多',     short: '拼', color: '#e02e24', domain: 'mobile.yangkeduo.com' },
    douyin:   { name: '抖音商城',   short: '抖', color: '#161823', domain: 'haohuo.jinritemai.com' },
    suning:   { name: '苏宁易购',   short: '苏', color: '#ffaa00', domain: 'm.suning.com' },
    sam:      { name: '山姆会员店', short: '山', color: '#0060a9', domain: 'www.samsclub.cn' },
    vip:      { name: '唯品会',     short: '唯', color: '#e4002b', domain: 'm.vip.com' },
    // 加油站
    sinopec:  { name: '中国石化',   short: '中石化', color: '#e60012', domain: '' },
    petro:    { name: '中国石油',   short: '中石油', color: '#d81e06', domain: '' },
    shell:    { name: '壳牌',       short: '壳牌', color: '#ffd100', domain: '' },
    cnooc:    { name: '中国海油',   short: '中海油', color: '#005baa', domain: '' },
    private:  { name: '民营加油站', short: '民营', color: '#7a8b99', domain: '' }
  };

  /* 解析商品规格 → 用于「单位价格」对比的基准数量
   * 统一走 calc.js 的公式解析（支持 ×份数、+赠品），结果缓存为 qtyInfo。
   * qtyInfo.qty = 总数量（含份数与赠品）
   */
  function parseQty(p) {
    if (p.qtyInfo && p.qtyInfo.qty > 0) return p.qtyInfo;
    const calc = global.PriceCalc;
    if (calc) {
      const r = calc.parseSpec(p.spec, p.category);
      if (r.ok && r.total > 0) {
        return { qty: r.total, unit: r.unit, label: r.label, per: r.per, packs: r.packs, gift: r.gift, text: r.text };
      }
    }
    // 兜底：旧逻辑
    const spec = String(p.spec || '');
    if (p.category === 'fuel') return { qty: 1, unit: '升', label: '每升' };
    if (p.category === 'milk') {
      const m = spec.match(/([\d.]+)\s*g/i);
      return { qty: m ? parseFloat(m[1]) : 0, unit: '克', label: '每克' };
    }
    if (p.category === 'diaper') {
      const m = spec.match(/([\d.]+)\s*片/);
      return { qty: m ? parseFloat(m[1]) : 0, unit: '片', label: '每片' };
    }
    return { qty: 0, unit: '件', label: '每件' };
  }

  const CATEGORIES = [
    { id: 'all',    name: '全部',   icon: 'all',    desc: '所有比价商品' },
    { id: 'milk',   name: '奶粉',   icon: 'milk',   desc: '婴幼儿配方奶粉' },
    { id: 'diaper', name: '纸尿裤', icon: 'diaper', desc: '纸尿裤 / 拉拉裤' },
    { id: 'fuel',   name: '加油',   icon: 'fuel',   desc: '各加油站油价' }
  ];

  // 各品类录入时可选的平台（电商用电商列表，加油用加油站列表）
  const PLATFORM_OPTIONS = {
    milk:   ['jd', 'tmall', 'pdd', 'douyin', 'suning', 'sam', 'vip'],
    diaper: ['jd', 'tmall', 'pdd', 'douyin', 'suning', 'sam', 'vip'],
    fuel:   ['sinopec', 'petro', 'shell', 'cnooc', 'private']
  };
  const CATEGORY_META = {
    milk:   { emoji: '🥛', accent: '#4a90e2', unit: '元' },
    diaper: { emoji: '👶', accent: '#f5a623', unit: '元' },
    fuel:   { emoji: '⛽', accent: '#f57c00', unit: '元/升' }
  };

  /* ---------------- 用户录入商品（本地持久化） ---------------- */
  const USER_KEY = 'shengqianmao_products_v1';
  function loadUserProducts() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function saveUserProducts(arr) {
    localStorage.setItem(USER_KEY, JSON.stringify(arr));
  }

  /* ---------------- 数据访问层 ----------------
   * 默认数据源为空（无内置商品），只显示用户录入。
   * 接真实接口时改写 fetchRemote()：
   *   async fetchRemote() { const r = await fetch('https://your-api/prices'); return r.json(); }
   * 电商官网有反爬与跨域限制，需走官方开放平台/数据服务商。
   */
  const dataSource = {
    mode: 'manual',
    async fetchRemote() {
      // 真实数据源入口：默认返回空数组
      return [];
    },
    async fetchPrices() {
      const remote = await this.fetchRemote();          // 未来真实 API
      const user = loadUserProducts();                   // 用户手动录入
      const all = remote.concat(user);
      // 确保所有商品都有规格信息
      all.forEach(p => { p.qtyInfo = parseQty(p); p.builtin = p.builtin === true; });
      return all;
    },
    // 用户录入商品 CRUD
    listUserProducts() { return loadUserProducts(); },
    saveUserProduct(p) {
      const arr = loadUserProducts();
      const i = arr.findIndex(x => x.id === p.id);
      const next = { ...p, builtin: false, updatedAt: Date.now() };
      if (i >= 0) arr[i] = next; else arr.push(next);
      saveUserProducts(arr);
      return next;
    },
    deleteUserProduct(id) {
      saveUserProducts(loadUserProducts().filter(x => x.id !== id));
    },
    getPlatform(key) {
      return PLATFORMS[key] || { name: key, short: (key || '?').slice(0, 2), color: '#888', domain: '' };
    },
    getAllPlatforms() { return PLATFORMS; },
    parseQty,
    getPlatformOptions(cat) { return PLATFORM_OPTIONS[cat] || []; },
    getCategoryMeta(cat) { return CATEGORY_META[cat] || { emoji: '📦', accent: '#888', unit: '元' }; }
  };

  global.PriceData = { PRODUCTS: [], CATEGORIES, PLATFORMS, dataSource };
})(window);
