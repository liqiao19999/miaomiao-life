/* ============================================================
 * app.js — 交互逻辑
 * 页面：home(大类入口) / list(分类列表) / detail(详情) /
 *       editor(录入编辑) / favorites(收藏) / me(我的)
 * ============================================================ */
(function () {
  'use strict';

  const { CATEGORIES, dataSource } = window.PriceData;

  // ---------- 本地存储（收藏/提醒/安装提示） ----------
  const Store = {
    KEY: 'shengqianmao_v1',
    data: { favorites: [], alerts: {}, installsDismissed: false, consumption: {} },
    load() {
      try {
        const raw = localStorage.getItem(this.KEY);
        if (raw) Object.assign(this.data, JSON.parse(raw));
      } catch (e) {}
      if (!this.data.consumption) this.data.consumption = {};
      return this.data;
    },
    save() { localStorage.setItem(this.KEY, JSON.stringify(this.data)); },
    clearPrefs() { localStorage.removeItem(this.KEY); this.data = { favorites: [], alerts: {}, installsDismissed: false, consumption: {} }; }
  };
  Store.load();

  // ---------- 状态 ----------
  let products = [];
  const state = { page: 'home', category: 'milk', query: '', sort: 'default', detailId: null };
  let detailReturnPage = 'list';   // 详情返回来源
  let listReturnPage = 'home';     // 列表页返回来源
  let editorReturnPage = 'list';   // 编辑器返回来源

  // ---------- DOM ----------
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const searchInput = $('#search-input');
  const searchClear = $('#search-clear');

  // ---------- 工具 ----------
  function fmtTime(ts) {
    const diff = Date.now() - ts, m = Math.floor(diff / 60000);
    if (m < 1) return '刚刚更新';
    if (m < 60) return m + ' 分钟前';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    return Math.floor(h / 24) + ' 天前';
  }
  function money(n) { return Number(n).toFixed(n % 1 === 0 ? 0 : 2); }
  function unit(p) { return p.category === 'fuel' ? '元/升' : '元'; }
  function priceLabel(p, n) { return (p.category === 'fuel' ? '' : '¥') + money(n) + (p.category === 'fuel' ? ' 元/升' : ''); }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // 到手价：标价经优惠计算后的实际支付价（比价一律以此为准）
  function payableOf(o) {
    const calc = window.PriceCalc;
    const c = calc ? calc.calcPayable(o.price, o.promo) : { payable: o.price, saved: 0, applied: false };
    return { payable: c.payable, saved: c.saved, applied: c.applied, desc: c.desc };
  }
  // 有效报价按「到手价」升序
  function validPlatforms(p) {
    return p.platforms
      .filter(x => x.stock && x.price > 0)
      .map(x => ({ ...x, _pay: payableOf(x) }))
      .sort((a, b) => a._pay.payable - b._pay.payable);
  }
  function bestOffer(p) {
    return validPlatforms(p)[0] || { key: '', price: 0, original: 0, promo: '暂无报价', stock: false, _pay: { payable: 0, saved: 0, applied: false } };
  }
  function maxSaving(p) {
    const vp = p.platforms.filter(x => x.price > 0).map(x => payableOf(x).payable);
    if (!vp.length) return 0;
    return Math.max(...vp) - Math.min(...vp);
  }
  // 单位价格：最低「到手价」 ÷ 总数量（元/克、元/片、元/升）
  function unitPrice(p) {
    const qty = (p.qtyInfo && p.qtyInfo.qty) || 0;
    const best = bestOffer(p);
    const pay = best._pay ? best._pay.payable : best.price;
    if (!pay || qty <= 0) return 0;
    return pay / qty;
  }
  function unitLabel(p) { return (p.qtyInfo && p.qtyInfo.label) || '每件'; }
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 1900);
  }

  // ---------- 导航 ----------
  function navigate(page) {
    state.page = page;
    $$('.page').forEach(pg => pg.classList.toggle('active', pg.id === 'page-' + page));
    const isTab = ['home', 'favorites', 'me'].includes(page);
    $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === page));
    $('#bottom-nav').style.display = isTab ? '' : 'none';
    document.body.classList.toggle('home-mode', page === 'home');
    if (page === 'list') renderList();
    if (page === 'compare') renderCompare();
    if (page === 'favorites') renderFavorites();
    if (page === 'me') { updateAlertCount(); updateMyProductCount(); }
    if (page === 'home') renderEntries();
    window.scrollTo(0, 0);
  }

  // ---------- 首页大类入口 ----------
  const ENTRIES = [
    { cat: 'milk',   icon: '🥛', title: '奶粉比价',   desc: '各平台婴幼儿配方奶粉' },
    { cat: 'diaper', icon: '👶', title: '纸尿裤比价', desc: '纸尿裤 / 拉拉裤' },
    { cat: 'fuel',   icon: '⛽', title: '加油比价',   desc: '92# / 95# / 98# 油价' },
    { cat: 'book',   icon: '💰', title: '记账',       desc: '收支记录 · 预算 · 统计', link: 'bookkeeping.html' }
  ];
  function renderEntries() {
    $('#entry-grid').innerHTML = ENTRIES.map(e => {
      let metaTxt;
      if (e.link) {
        metaTxt = '点击进入记账模块';
      } else {
        const count = products.filter(p => p.category === e.cat).length;
        const min = products.filter(p => p.category === e.cat && bestOffer(p).price > 0);
        metaTxt = count === 0 ? '还没有商品 · 点击进入录入' :
          (min.length ? `${count} 款商品 · 到手最低 ${priceLabel(min[0], bestOffer(min[0])._pay.payable)}` : `${count} 款商品 · 暂无价格`);
      }
      return `<button class="entry-card entry-${e.cat}" data-cat="${e.cat}" ${e.link ? `data-link="${e.link}"` : ''}>
        <div class="entry-icon">${e.icon}</div>
        <div class="entry-info">
          <div class="entry-title">${e.title}</div>
          <div class="entry-desc">${e.desc}</div>
          <div class="entry-meta">${metaTxt}</div>
        </div>
        <span class="entry-arrow">›</span>
      </button>`;
    }).join('');
    $$('#entry-grid .entry-card').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.link) { window.location.href = btn.dataset.link; return; }
        openCategory(btn.dataset.cat);
      });
    });
  }
  function openCategory(cat) {
    state.category = cat;
    state.query = '';
    if (searchInput) searchInput.value = '';
    if (searchClear) searchClear.hidden = true;
    listReturnPage = 'home';
    navigate('list');
  }
  function openMyProducts() {
    state.category = 'all';
    state.query = '';
    if (searchInput) searchInput.value = '';
    if (searchClear) searchClear.hidden = true;
    listReturnPage = 'me';
    state.onlyMine = true;
    navigate('list');
  }

  // ---------- 列表页 ----------
  function getListProducts() {
    let list = products.slice();
    if (state.onlyMine) list = list.filter(p => !p.builtin);
    else list = list.filter(p => p.category === state.category);
    const q = (state.query || '').trim().toLowerCase();
    if (q) {
      list = list.filter(p => {
        const platNames = p.platforms.map(x => dataSource.getPlatform(x.key).name).join(' ');
        return (p.brand + p.name + p.spec + (p.tags || []).join(' ') + platNames).toLowerCase().includes(q);
      });
    }
    switch (state.sort) {
      case 'price-asc': list.sort((a, b) => bestOffer(a)._pay.payable - bestOffer(b)._pay.payable); break;
      case 'save-desc': list.sort((a, b) => maxSaving(b) - maxSaving(a)); break;
      case 'time': list.sort((a, b) => b.updatedAt - a.updatedAt); break;
    }
    return list;
  }

  function productCardHTML(p) {
    const best = bestOffer(p), save = maxSaving(p);
    const fav = Store.data.favorites.includes(p.id);
    const hasAlert = !!Store.data.alerts[p.id];
    const plat = dataSource.getPlatform(best.key);
    return `
      <article class="product-card" data-id="${p.id}">
        <div class="pc-thumb" style="background:linear-gradient(135deg, ${p.accent}22, ${p.accent}0d)">${p.emoji}</div>
        <div class="pc-body">
          <div class="pc-brand">${escapeHtml(p.brand)}${p.builtin ? '' : ' <span class="mine-tag">录入</span>'}</div>
          <div class="pc-name">${escapeHtml(p.name)}</div>
          <div class="pc-spec">${escapeHtml(p.spec)} · ${fmtTime(p.updatedAt)}</div>
          <div class="pc-tags">${(p.tags || []).map(t => `<span class="pc-tag">${escapeHtml(t)}</span>`).join('')}</div>
          <div class="pc-bottom">
            <div class="pc-price-block">
              <div class="pc-price">${priceLabel(p, best._pay.payable)}</div>
              <div class="pc-price-label">到手价 · ${escapeHtml(plat.name)}${best._pay.applied ? '（已优惠）' : ''}</div>
            </div>
            ${save > 0 ? `<div class="pc-save">最多省 ${priceLabel(p, save)}</div>` : ''}
          </div>
        </div>
        <button class="pc-fav ${fav ? 'on' : ''}" data-fav="${p.id}" aria-label="收藏">${fav ? '★' : '☆'}</button>
        ${hasAlert ? '<span class="pc-alert-badge" title="已设提醒">🔔</span>' : ''}
        ${!p.builtin ? `<button class="pc-del" data-del="${p.id}" aria-label="删除">🗑</button>` : ''}
      </article>`;
  }

  function renderList() {
    const catName = CATEGORIES.find(c => c.id === state.category)?.name || '全部';
    $('#list-title').textContent = state.onlyMine ? '我录入的商品' : catName + '比价';
    $('#list-add').hidden = !!state.onlyMine;
    const list = getListProducts();
    let emptyHtml;
    if (state.query) {
      emptyHtml = `<div class="empty-state"><div class="empty-icon">🔍</div><p>没有找到相关商品</p><span>换个关键词试试</span></div>`;
    } else {
      emptyHtml = `<div class="empty-state"><div class="empty-icon">✍️</div><p>这里还没有商品</p><span>点右上角「＋录入」添加第一件商品，开始比价</span></div>`;
    }
    $('#list-product-list').innerHTML = list.length ? list.map(productCardHTML).join('') : emptyHtml;
    bindProductCards($('#list-product-list'));
    renderLowStrip();
    $('#update-note').textContent = `共 ${list.length} 款`;
  }

  function discountRate(p) {
    const best = bestOffer(p);
    const pay = best._pay ? best._pay.payable : best.price;
    const highs = p.platforms.map(x => x.original || x.price).filter(v => v > 0);
    const high = highs.length ? Math.max(...highs) : 0;
    return high > 0 ? (high - pay) / high : 0;
  }
  function renderLowStrip() {
    const pool = products.filter(p => state.onlyMine ? !p.builtin : p.category === state.category);
    const ranked = pool.filter(p => bestOffer(p).price > 0)
      .sort((a, b) => discountRate(b) - discountRate(a)).slice(0, 6);
    const strip = $('#lowprice-strip');
    if (!ranked.length) { strip.innerHTML = '<div class="strip-empty">暂无价格数据</div>'; return; }
    strip.innerHTML = ranked.map((p, i) => {
      const best = bestOffer(p), plat = dataSource.getPlatform(best.key);
      const rate = Math.round(discountRate(p) * 100);
      return `<button class="low-card" data-id="${p.id}">
        <span class="rank">省 ${rate}% · TOP ${i + 1}</span>
        <span class="low-emoji">${p.emoji}</span>
        <div class="low-name">${escapeHtml(p.brand)} ${escapeHtml(p.name)}</div>
        <div class="low-price">${priceLabel(p, best._pay.payable)}</div>
        <div class="low-plat">到手 · ${escapeHtml(plat.name)} · ${escapeHtml(p.spec)}</div>
      </button>`;
    }).join('');
    $$('#lowprice-strip .low-card').forEach(btn => btn.addEventListener('click', () => openDetail(btn.dataset.id)));
  }

  function bindProductCards(container) {
    container.querySelectorAll('.product-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-fav]')) return;
        openDetail(card.dataset.id);
      });
    });
    container.querySelectorAll('[data-fav]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); toggleFav(btn.dataset.fav); });
    });
    container.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); deleteProduct(btn.dataset.del); });
    });
  }

  // 删除录入商品（卡片/我的录入列表入口）
  function deleteProduct(id) {
    const p = products.find(x => x.id === id);
    if (!p || p.builtin) return;
    if (!confirm(`确定删除「${p.brand} ${p.name}」？此操作不可恢复。`)) return;
    doDeleteProduct(id);
  }
  function doDeleteProduct(id) {
    dataSource.deleteUserProduct(id);
    Store.data.favorites = Store.data.favorites.filter(x => x !== id);
    delete Store.data.alerts[id];
    Store.save();
    toast('已删除');
    reload().then(() => {
      renderList();
      renderFavorites();
      updateMyProductCount();
      if (state.page === 'compare') renderCompare();
      if (state.detailId === id) navigate(listReturnPage);
    });
  }

  function toggleFav(id) {
    const i = Store.data.favorites.indexOf(id);
    if (i >= 0) { Store.data.favorites.splice(i, 1); toast('已取消收藏'); }
    else { Store.data.favorites.push(id); toast('已收藏 ⭐'); }
    Store.save();
    renderList(); renderFavorites();
    if (state.detailId === id) {
      const btn = $('#detail-fav');
      if (btn) { const on = Store.data.favorites.includes(id); btn.textContent = on ? '★ 已收藏' : '☆ 收藏'; btn.classList.toggle('on', on); }
    }
  }

  // ---------- 详情 ----------
  function openDetail(id) {
    const p = products.find(x => x.id === id);
    if (!p) return;
    if (state.page !== 'detail') detailReturnPage = state.page;
    state.detailId = id;
    const best = bestOffer(p), bestPlat = dataSource.getPlatform(best.key);
    const fav = Store.data.favorites.includes(p.id), alert = Store.data.alerts[p.id];

    const sortedOffers = validPlatforms(p);
    const bestKey = sortedOffers.length ? sortedOffers[0].key : null;
    const rows = p.platforms.slice().map(o => ({ ...o, _pay: payableOf(o) }))
      .sort((a, b) => (a._pay.payable || 9999) - (b._pay.payable || 9999)).map(o => {
      const plat = dataSource.getPlatform(o.key);
      const isBest = o.key === bestKey;
      const payVal = o.price > 0 ? priceLabel(p, o._pay.payable) : '暂无';
      const promoLine = o._pay.applied
        ? `${escapeHtml(o.promo || o._pay.desc)} · 已省 ${priceLabel(p, o._pay.saved)}`
        : escapeHtml(o.promo || (o.stock ? '无额外优惠' : '暂时无货'));
      return `<div class="price-row ${isBest ? 'best' : ''} ${o.stock ? '' : 'stock-out'}">
        ${isBest ? '<span class="best-flag">到手最低</span>' : ''}
        <div class="plat-logo" style="background:${plat.color}">${escapeHtml(plat.short.slice(0, 2))}</div>
        <div class="plat-info">
          <div class="plat-name">${escapeHtml(plat.name)}${o.distance ? ' · ' + escapeHtml(o.distance) : ''}${o.stock ? '' : ' · 无货'}</div>
          <div class="plat-promo">${promoLine}</div>
        </div>
        <div class="plat-price-col">
          <div class="plat-price ${isBest ? 'best' : ''}">${payVal}</div>
          ${o._pay.applied ? `<div class="plat-original">标价 ${priceLabel(p, o.price)}</div>` : (o.original > 0 ? `<div class="plat-original">${priceLabel(p, o.original)}</div>` : '')}
        </div>
      </div>`;
    }).join('');

    $('#detail-content').innerHTML = `
      <div class="detail-hero">
        <div class="dh-top">
          <div class="dh-thumb" style="background:linear-gradient(135deg, ${p.accent}22, ${p.accent}0d)">${p.emoji}</div>
          <div class="dh-title">
            <div class="dh-brand">${escapeHtml(p.brand)}${p.builtin ? '' : ' <span class="mine-tag">录入</span>'}</div>
            <div class="dh-name">${escapeHtml(p.name)}</div>
            <div class="dh-spec">${escapeHtml(p.spec)}</div>
            <div class="dh-tags">${(p.tags || []).map(t => `<span class="pc-tag">${escapeHtml(t)}</span>`).join('')}</div>
          </div>
        </div>
        <div class="dh-best">
          <span class="dh-best-label">最低到手价</span>
          <span class="dh-best-price">${priceLabel(p, best._pay.payable)}</span>
          <span class="dh-best-plat">${escapeHtml(bestPlat.name)}${best._pay.applied ? ' · 已优惠' : ''}</span>
        </div>
        <div class="dh-spec" style="margin-top:8px">规格：${escapeHtml(p.qtyInfo && p.qtyInfo.text ? p.qtyInfo.text : p.spec)} ｜ 单价：${unitPrice(p).toFixed(4)} 元/${escapeHtml(unitLabel(p).replace('每',''))}</div>
        <div class="dh-days" id="detail-days"></div>
      </div>
      <div class="detail-actions">
        <button class="action-btn ghost ${fav ? 'on' : ''}" id="detail-fav">${fav ? '★ 已收藏' : '☆ 收藏'}</button>
        <button class="action-btn primary" id="detail-edit">✍️ 编辑价格</button>
      </div>
      <div class="detail-section">
        <h3>📊 各平台价格对比 <span class="badge">${validPlatforms(p).length} 个平台</span></h3>
        <div class="price-table">${rows}</div>
      </div>
      <div class="detail-section">
        <h3>🔔 降价提醒</h3>
        <div class="alert-row">
          <span class="a-label">${alert ? `低于 ${priceLabel(p, alert.target)} 时提醒我` : '设置目标价，降价时提醒'}</span>
          <button class="action-btn ghost" style="flex:none;padding:6px 14px;height:auto;font-size:12px" id="detail-alert">${alert ? '修改' : '设置'}</button>
        </div>
      </div>`;

    $('#detail-fav').addEventListener('click', () => toggleFav(id));
    $('#detail-edit').addEventListener('click', () => openEditor(id));
    $('#detail-alert').addEventListener('click', () => openAlertDialog(id));
    // 可食用天数
    const days = daysFor(p);
    const dd = $('#detail-days');
    if (days != null) {
      const u = p.category === 'milk' ? 'ml' : (p.category === 'diaper' ? '片' : '升');
      dd.innerHTML = `📅 按消耗参数可用约 <b>${days}</b> 天（每日约 ${window.PriceCalc.usableDays(p.qtyInfo, Store.data.consumption, p.category).daily} ${u}）`;
      dd.classList.add('has-days');
    } else {
      dd.innerHTML = '<button class="days-set-btn" id="days-set">📅 设置消耗参数，查看可使用天数</button>';
      $('#days-set').addEventListener('click', () => openConsumption(p.category));
    }
    navigate('detail');
  }

  // ---------- 提醒 ----------
  function openAlertDialog(id) {
    const p = products.find(x => x.id === id), cur = Store.data.alerts[id];
    const b = bestOffer(p), bpay = b._pay ? b._pay.payable : b.price;
    $('#alert-hint').textContent = `${p.brand} ${p.name} · 当前最低到手价 ${dataSource.getPlatform(b.key).name} ${priceLabel(p, bpay)}`;
    $('#alert-price').value = cur ? cur.target : (bpay * 0.95).toFixed(2);
    $('#alert-mask').dataset.id = id;
    $('#alert-mask').hidden = false;
    setTimeout(() => $('#alert-price').focus(), 100);
  }
  function saveAlert() {
    const id = $('#alert-mask').dataset.id;
    const v = parseFloat($('#alert-price').value);
    if (!v || v <= 0) { toast('请输入有效价格'); return; }
    Store.data.alerts[id] = { target: v, createdAt: Date.now() };
    Store.save();
    $('#alert-mask').hidden = true;
    toast('提醒已设置 🔔');
    updateAlertCount();
    if (state.detailId === id) openDetail(id);
    renderList();
  }
  function updateAlertCount() { $('#alert-count').textContent = Object.keys(Store.data.alerts).length + ' 个商品'; }
  function updateMyProductCount() { $('#my-product-count').textContent = dataSource.listUserProducts().length + ' 个'; }

  // ---------- 录入 / 编辑 ----------
  let platformRowSeq = 0;
  function platformRowHTML(key, price, promo) {
    const opts = Object.keys(dataSource.getAllPlatforms()).map(k => {
      const p = dataSource.getAllPlatforms()[k];
      return `<option value="${k}" ${k === key ? 'selected' : ''}>${escapeHtml(p.name)}</option>`;
    }).join('');
    const id = 'prow-' + (++platformRowSeq);
    return `<div class="platform-row" id="${id}">
      <select class="prow-key" aria-label="平台">${opts}</select>
      <input type="number" class="prow-price" step="0.01" min="0" placeholder="价格" value="${price != null ? price : ''}">
      <input type="text" class="prow-promo" placeholder="优惠（如 满199减30 / 9折 / 减20）" value="${escapeHtml(promo || '')}">
      <button type="button" class="prow-del" title="删除此平台">✕</button>
      <div class="prow-payable" title="按优惠自动计算的到手价"></div>
    </div>`;
  }
  function syncPlatformOptionsForCategory(cat) {
    // 根据品类把每条下拉限制为对应平台集合
    const allowed = dataSource.getPlatformOptions(cat);
    $$('#platform-rows .prow-key').forEach(sel => {
      const cur = sel.value;
      sel.innerHTML = allowed.map(k => {
        const p = dataSource.getPlatform(k);
        return `<option value="${k}" ${k === cur ? 'selected' : ''}>${escapeHtml(p.name)}</option>`;
      }).join('');
    });
  }
  function updatePayablePreview(row) {
    const box = row.querySelector('.prow-payable');
    if (!box) return;
    const price = parseFloat(row.querySelector('.prow-price').value);
    const promo = row.querySelector('.prow-promo').value.trim();
    if (!price || price <= 0) { box.textContent = ''; box.className = 'prow-payable'; return; }
    const r = window.PriceCalc ? window.PriceCalc.calcPayable(price, promo) : { payable: price, saved: 0, applied: false };
    box.textContent = r.applied
      ? `到手价 ¥${money(r.payable)}（省 ¥${money(r.saved)}）`
      : (promo ? `优惠「${promo}」未生效，按标价 ¥${money(price)}` : `到手价 ¥${money(price)}`);
    box.className = 'prow-payable' + (r.applied ? ' applied' : '');
  }
  function bindPlatformRow(row) {
    row.querySelector('.prow-del').addEventListener('click', () => {
      if (document.querySelectorAll('#platform-rows .platform-row').length <= 1) { toast('至少保留一个平台'); return; }
      row.remove();
    });
    row.querySelector('.prow-price').addEventListener('input', () => updatePayablePreview(row));
    row.querySelector('.prow-promo').addEventListener('input', () => updatePayablePreview(row));
    updatePayablePreview(row);
  }
  function addPlatformRow(key, price, promo) {
    const wrap = $('#platform-rows');
    wrap.insertAdjacentHTML('beforeend', platformRowHTML(key, price, promo));
    bindPlatformRow(wrap.lastElementChild);
  }
  // ---------- 规格构建器（结构化字段 → 总量） ----------
  const SPEC_META = {
    milk:   { pack: '罐', unit: 'g',  buyLabel: '购买罐数', perLabel: '单罐克重', giftLabel: '赠送罐数', giftPerLabel: '赠送单罐克重' },
    diaper: { pack: '包', unit: '片', buyLabel: '购买包数', perLabel: '单包片数', giftLabel: '赠送包数', giftPerLabel: '赠送单包片数' },
    fuel:   { pack: '升', unit: '升', buyLabel: '购买升数', perLabel: '每升',     giftLabel: '赠送升数', giftPerLabel: '赠送升数' }
  };
  function syncSpecLabels(cat) {
    const m = SPEC_META[cat] || SPEC_META.milk;
    $('#lbl-buy-packs').textContent = m.buyLabel;
    $('#lbl-per-pack').textContent = m.perLabel;
    $('#lbl-gift-packs').textContent = m.giftLabel;
    $('#lbl-gift-per').textContent = m.giftPerLabel;
    $('#unit-per-pack').textContent = m.unit;
    $('#unit-gift-per').textContent = m.unit;
    // 加油不走结构化规格，隐藏整个构建器，总量固定 1 升
    const builder = $('.spec-builder');
    if (builder) builder.hidden = (cat === 'fuel');
  }
  function giftEnabled() { return $('#gift-switch').classList.contains('on'); }
  function recalcSpecBuilder() {
    const cat = $('#edit-category').value;
    if (cat === 'fuel') {
      $('#edit-spec').value = '元/升';
      $('#edit-qty').value = 1;
      const tv = $('#spec-total-val'); if (tv) tv.textContent = '1 升';
      return;
    }
    const bp = $('#buy-packs').value, pp = $('#per-pack').value;
    const gp = giftEnabled() ? $('#gift-packs').value : 0;
    const gper = giftEnabled() ? $('#gift-per').value : 0;
    if (!window.PriceCalc) return;
    const r = window.PriceCalc.buildSpecInfo(bp, pp, gp, gper, cat);
    $('#edit-spec').value = r.text;
    $('#edit-qty').value = r.qty || '';
    const tv = $('#spec-total-val');
    if (tv) { tv.textContent = r.ok ? `${r.qty} ${r.unit}` : '—'; tv.style.color = r.ok ? 'var(--down)' : 'var(--text-3)'; }
  }
  // 编辑时把已存 qtyInfo 回填到结构化字段
  function loadSpecBuilder(p) {
    const cat = $('#edit-category').value;
    syncSpecLabels(cat);
    if (cat === 'fuel') { recalcSpecBuilder(); return; }
    const q = (p && p.qtyInfo) || {};
    const hasGift = (q.gift || 0) > 0;
    $('#buy-packs').value = q.packs != null ? q.packs : '';
    $('#per-pack').value = q.per != null ? q.per : '';
    $('#gift-packs').value = hasGift ? q.gift : '';
    $('#gift-per').value = (hasGift && q.giftPer) ? q.giftPer : '';
    setGiftSwitch(hasGift);
    recalcSpecBuilder();
  }
  function setGiftSwitch(on) {
    const s = $('#gift-switch');
    if (!s) return;
    s.classList.toggle('on', on);
    $('#gift-section').hidden = !on;
  }
  // ---------- 消耗参数 ----------
  function openConsumption(cat) {
    const c = Store.data.consumption;
    const m = c.milk || {}, d = c.diaper || {}, f = c.fuel || {};
    $('#cons-milk-times').value = m.times || '';
    $('#cons-milk-spoons').value = m.spoons || '';
    $('#cons-milk-gram').value = m.gram || '';
    $('#cons-diaper-pcs').value = d.pcs || '';
    $('#cons-fuel-liters').value = f.liters || '';
    switchConsTab(cat || 'milk');
    $('#consumption-mask').hidden = false;
  }
  function switchConsTab(cat) {
    $$('.cons-tab').forEach(t => t.classList.toggle('active', t.dataset.cat === cat));
    $$('.cons-panel').forEach(p => { p.hidden = p.dataset.panel !== cat; });
  }
  function saveConsumption() {
    Store.data.consumption = {
      milk: {
        times: parseFloat($('#cons-milk-times').value) || 0,
        spoons: parseFloat($('#cons-milk-spoons').value) || 0,
        gram: parseFloat($('#cons-milk-gram').value) || 0
      },
      diaper: { pcs: parseFloat($('#cons-diaper-pcs').value) || 0 },
      fuel: { liters: parseFloat($('#cons-fuel-liters').value) || 0 }
    };
    Store.save();
    $('#consumption-mask').hidden = true;
    toast('消耗参数已保存 ✓（用于计算可使用天数）');
    // 刷新当前页展示
    if (state.page === 'detail' && state.detailId) openDetail(state.detailId);
    if (state.page === 'compare') renderCompare();
    if (state.page === 'list') renderList();
  }
  // 商品可食用天数
  function daysFor(p) {
    if (!window.PriceCalc) return null;
    return window.PriceCalc.usableDays(p.qtyInfo, Store.data.consumption, p.category).days;
  }

  // ---------- 截图识别 ----------
  let ocrSelectedPrice = null;
  function resetOcrDialog() {
    $('#ocr-loading').hidden = true;
    $('#ocr-result').hidden = true;
    $('#ocr-actions').hidden = true;
    $('#ocr-status').textContent = '正在识别…';
  }
  function openOcrDialog() {
    resetOcrDialog();
    $('#ocr-file').value = '';
    $('#ocr-mask').hidden = false;
  }
  async function handleOcrFile(file) {
    if (!file) return;
    if (!window.PriceOCR) { toast('识别模块未加载'); return; }
    $('#ocr-loading').hidden = false;
    $('#ocr-result').hidden = true;
    $('#ocr-actions').hidden = true;
    $('#ocr-status').textContent = '正在识别…';
    try {
      const text = await window.PriceOCR.recognize(file, (msg) => { $('#ocr-status').textContent = msg; });
      if (!text || !text.trim()) {
        $('#ocr-loading').hidden = true;
        toast('未识别到文字，请换一张更清晰的截图');
        return;
      }
      const cat = $('#edit-category').value;
      const f = window.PriceOCR.extractFields(text, cat);
      $('#ocr-brand').value = f.brand || '';
      $('#ocr-name').value = f.name || '';
      $('#ocr-qty').value = f.qty || '';
      $('#ocr-raw').textContent = f.raw;
      ocrSelectedPrice = f.mainPrice || (f.prices[0] || null);
      const chips = f.prices.length
        ? f.prices.map(p => `<button type="button" class="ocr-price-chip" data-price="${p}">¥${money(p)}</button>`).join('')
        : '<span class="ocr-price-empty">未识别到价格，可手动填写下方价格</span>';
      $('#ocr-price-chips').innerHTML = chips;
      $$('#ocr-price-chips .ocr-price-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          ocrSelectedPrice = parseFloat(btn.dataset.price);
          $$('#ocr-price-chips .ocr-price-chip').forEach(b => b.style.opacity = '0.55');
          btn.style.opacity = '1';
          toast('已选择价格 ¥' + money(ocrSelectedPrice));
        });
      });
      $('#ocr-loading').hidden = true;
      $('#ocr-result').hidden = false;
      $('#ocr-actions').hidden = false;
    } catch (e) {
      $('#ocr-loading').hidden = true;
      toast(e && e.message ? e.message : '识别失败，请手动录入');
    }
  }
  function applyOcrResult() {
    const brand = $('#ocr-brand').value.trim();
    const name = $('#ocr-name').value.trim();
    const qty = parseFloat($('#ocr-qty').value);
    if (brand) $('#edit-brand').value = brand;
    if (name) $('#edit-name').value = name;
    if (qty > 0) {
      // OCR 识别的数量作为「单份数量」，购买份数默认 1
      if ($('#edit-category').value === 'fuel') { /* 加油固定 */ }
      else {
        $('#buy-packs').value = 1;
        $('#per-pack').value = qty;
        recalcSpecBuilder();
      }
    }
    if (ocrSelectedPrice > 0) {
      const firstPrice = $('#platform-rows .prow-price');
      if (firstPrice) firstPrice.value = ocrSelectedPrice;
    }
    $('#ocr-mask').hidden = true;
    toast('已填入，请核对并补充其他平台价格');
  }

  function openEditor(id) {
    editorReturnPage = state.page === 'detail' ? detailReturnPage : state.page;
    const p = id ? products.find(x => x.id === id) : null;
    $('#editor-title').textContent = p ? '编辑商品价格' : '录入商品';
    $('#edit-id').value = p ? p.id : '';
    $('#edit-category').value = p ? p.category : (state.category === 'all' ? 'milk' : state.category);
    $('#edit-brand').value = p ? p.brand : '';
    $('#edit-name').value = p ? p.name : '';
    loadSpecBuilder(p);
    const rows = $('#platform-rows');
    rows.innerHTML = '';
    const list = p && p.platforms.length ? p.platforms : [{ key: null, price: '', promo: '' }];
    list.forEach(o => addPlatformRow(o.key || undefined, o.price || '', o.promo || ''));
    syncPlatformOptionsForCategory($('#edit-category').value);
    $('#editor-delete').hidden = !(p && !p.builtin);
    navigate('editor');
  }

  function submitEditor(e) {
    e.preventDefault();
    const cat = $('#edit-category').value;
    const brand = $('#edit-brand').value.trim();
    const name = $('#edit-name').value.trim();
    const spec = $('#edit-spec').value.trim();
    if (!brand || !name) { toast('请填写品牌和名称'); return; }
    const rows = $$('#platform-rows .platform-row');
    const seen = {};
    const platforms = [];
    for (const row of rows) {
      const key = row.querySelector('.prow-key').value;
      const price = parseFloat(row.querySelector('.prow-price').value);
      const promo = row.querySelector('.prow-promo').value.trim();
      if (!key) continue;
      if (seen[key]) { toast('同一平台请勿重复添加'); return; }
      seen[key] = 1;
      platforms.push({ key, price: isNaN(price) ? 0 : price, original: 0, promo, stock: price > 0 });
    }
    if (!platforms.length) { toast('请至少填写一个平台价格'); return; }
    // 由结构化规格字段构建 qtyInfo（含每份/份数/赠品，用于展示与编辑回填）
    let qtyInfo;
    if (cat === 'fuel') {
      qtyInfo = { qty: 1, unit: '升', label: '每升', text: '按每升计价' };
    } else if (window.PriceCalc) {
      const bp = $('#buy-packs').value, pp = $('#per-pack').value;
      const gp = giftEnabled() ? $('#gift-packs').value : 0;
      const gper = giftEnabled() ? $('#gift-per').value : 0;
      const r = window.PriceCalc.buildSpecInfo(bp, pp, gp, gper, cat);
      if (r.ok && r.qty > 0) {
        qtyInfo = { qty: r.qty, unit: r.unit, label: r.label, per: r.per, packs: r.packs, gift: r.gift, giftPer: r.giftPer, text: r.text };
      }
    }
    if (!qtyInfo) { toast('请填写完整的规格（购买份数与单份数量）'); return; }
    const oldId = $('#edit-id').value;
    const existing = oldId ? products.find(x => x.id === oldId) : null;
    const meta = dataSource.getCategoryMeta(cat);
    const item = {
      id: oldId || ('user-' + Date.now() + '-' + Math.floor(Math.random() * 1000)),
      category: cat, brand, name,
      spec: spec || (cat === 'fuel' ? '元 / 升' : '—'),
      emoji: existing ? existing.emoji : meta.emoji,
      accent: existing ? existing.accent : meta.accent,
      tags: existing ? existing.tags : ['手动录入'],
      platforms,
      qtyInfo: qtyInfo || (existing ? existing.qtyInfo : null),
      history: existing ? existing.history : [],
      updatedAt: Date.now(),
      builtin: false
    };
    dataSource.saveUserProduct(item);
    toast(oldId ? '已更新价格 ✓' : '录入成功，已加入比价 ✓');
    // 重新加载数据后回到列表
    reload().then(() => {
      state.category = cat;
      state.onlyMine = false;
      navigate('list');
    });
  }

  function deleteEditorProduct() {
    const id = $('#edit-id').value;
    if (!id) return;
    if (!confirm('确定删除这个录入的商品？')) return;
    dataSource.deleteUserProduct(id);
    Store.data.favorites = Store.data.favorites.filter(x => x !== id);
    delete Store.data.alerts[id];
    Store.save();
    toast('已删除');
    reload().then(() => navigate(editorReturnPage === 'detail' ? 'list' : editorReturnPage));
  }

  // ---------- 收藏 ----------
  function renderFavorites() {
    const list = products.filter(p => Store.data.favorites.includes(p.id));
    $('#favorites-empty').hidden = list.length > 0;
    $('#favorites-list').innerHTML = list.map(productCardHTML).join('');
    bindProductCards($('#favorites-list'));
  }

  // ---------- 横向对比与优势推荐 ----------
  // 参考「奶粉比价工具」「纸尿裤对比工具」：按单位价格横向比较，标注优势并给出推荐
  function renderCompare() {
    const cat = state.category;
    const catName = state.onlyMine ? '我的录入' : (CATEGORIES.find(c => c.id === cat)?.name || '全部');
    $('#compare-title').textContent = catName + ' · 横向对比';

    // 参与对比：当前分类（或我录入的全部）、有有效报价、能算出单位价格的商品
    // 注意：不同分类单位不同，onlyMine 模式只纳入同单位商品，否则不可比
    let pool;
    if (state.onlyMine) {
      const mine = products.filter(p => !p.builtin && unitPrice(p) > 0);
      const firstUnit = mine.length ? (mine[0].qtyInfo && mine[0].qtyInfo.unit) : null;
      pool = mine.filter(p => (p.qtyInfo && p.qtyInfo.unit) === firstUnit);
    } else {
      pool = products.filter(p => p.category === cat && unitPrice(p) > 0);
    }
    const content = $('#compare-content');

    if (pool.length < 2) {
      content.innerHTML = `<div class="compare-empty">
        <div class="ce-icon">📊</div>
        <p>至少需要 2 款可比商品</p>
        <span>当前分类有 ${pool.length} 款可计算单价的商品。请到分类页录入更多商品，并填写规格数量。</span>
      </div>`;
      return;
    }

    // 按单位价格升序（越低越划算）
    const ranked = pool.slice().sort((a, b) => unitPrice(a) - unitPrice(b));
    const best = ranked[0], bestUnit = unitPrice(best);
    const worstUnit = unitPrice(ranked[ranked.length - 1]);
    const unitLbl = unitLabel(best);

    // 找出各项优势（均以到手价为准）
    const minTotal = Math.min(...pool.map(p => bestOffer(p)._pay.payable));
    const maxPlatCount = Math.max(...pool.map(p => validPlatforms(p).length));
    const maxDiscount = Math.max(...pool.map(p => discountRate(p)));

    // ---- 智能推荐语（参考纸尿裤工具的 summary-tip） ----
    const betterCount = ranked.slice(1).filter(p => unitPrice(p) > bestUnit).length;
    const savePerUnit = ranked.slice(1).reduce((s, p) => s + (unitPrice(p) - bestUnit), 0) / Math.max(1, betterCount);
    const pctSaved = worstUnit > 0 ? Math.round((1 - bestUnit / worstUnit) * 100) : 0;
    const bestPlat = dataSource.getPlatform(bestOffer(best).key);
    const bestPay = bestOffer(best)._pay.payable;
    let recommend = `综合到手单价最低的是 <b>${escapeHtml(best.brand)} ${escapeHtml(best.name)}</b>（${bestPlat.name} 到手 ${priceLabel(best, bestPay)}）。`;
    if (betterCount > 0 && savePerUnit > 0) {
      recommend += ` 每${unitLbl.replace('每', '')}约省 <b>${savePerUnit.toFixed(4)} 元</b>，相比最贵的一款最多便宜 <b>${pctSaved}%</b>。`;
    }
    recommend += ' 单位价格已综合考虑规格差异，推荐优先购买。';

    // ---- 顶部统计 ----
    const stats = `
      <div class="cmp-stats">
        <div class="cmp-stat"><div class="cs-val">${ranked.length}</div><div class="cs-label">参与对比</div></div>
        <div class="cmp-stat"><div class="cs-val">${bestUnit.toFixed(4)}</div><div class="cs-label">最低单价 · ${escapeHtml(unitLbl)}</div></div>
        <div class="cmp-stat"><div class="cs-val">${pctSaved}%</div><div class="cs-label">最大单价差</div></div>
      </div>`;

    // ---- 排名列表 ----
    const items = ranked.map((p, i) => {
      const up = unitPrice(p);
      const isBest = i === 0;
      const diff = up - bestUnit;
      const diffPct = bestUnit > 0 ? (diff / bestUnit * 100) : 0;
      const bestPlat = dataSource.getPlatform(bestOffer(p).key);
      const pc = validPlatforms(p).length;
      const badges = [];
      if (isBest) badges.push('<span class="cmp-badge gold">🏆 单价最低</span>');
      if (bestOffer(p)._pay.payable === minTotal) badges.push('<span class="cmp-badge green">💰 到手价最低</span>');
      if (pc === maxPlatCount && pc > 0) badges.push('<span class="cmp-badge blue">🏪 平台最多</span>');
      if (discountRate(p) === maxDiscount && maxDiscount > 0) badges.push('<span class="cmp-badge gray">🏷️ 折扣最大</span>');
      if (!p.builtin) badges.push('<span class="cmp-badge gray">✍️ 我录入的</span>');
      const diffTxt = isBest ? '<span class="cmp-diff best">✓ 最优</span>'
        : `<span class="cmp-diff">贵 ${diffPct.toFixed(1)}%</span>`;
      return `<div class="cmp-item ${isBest ? 'rank-1' : ''}">
        <span class="cmp-rank ${isBest ? 'r1' : ''}">${isBest ? '推荐' : '第 ' + (i + 1) + ' 名'}</span>
        <div class="cmp-thumb" style="background:linear-gradient(135deg, ${p.accent}22, ${p.accent}0d)">${p.emoji}</div>
        <div class="cmp-body">
          <div class="cmp-name">${escapeHtml(p.brand)} ${escapeHtml(p.name)}</div>
          <div class="cmp-meta">${escapeHtml(p.spec)} · 到手最低 ${escapeHtml(bestPlat.name)} · ${validPlatforms(p).length} 个平台</div>
          <div class="cmp-badges">${badges.join('')}</div>
          <div class="cmp-unit-row">
            <span class="cmp-unit-price ${isBest ? 'best' : ''}">${up.toFixed(4)}</span>
            <span class="cmp-unit-label">元/${escapeHtml(unitLbl.replace('每', ''))}</span>
            ${diffTxt}
          </div>
          <div class="cmp-foot">到手 ${priceLabel(p, bestOffer(p)._pay.payable)} ÷ 规格 ${(p.qtyInfo && p.qtyInfo.qty) || '-'} ${escapeHtml((p.qtyInfo && p.qtyInfo.unit) || '')}${bestOffer(p)._pay.applied ? '（含优惠）' : ''} · 相差 ${isBest ? '—' : diff.toFixed(4) + ' 元/' + escapeHtml(unitLbl.replace('每', ''))}</div>
          ${(() => { const d = daysFor(p); return d != null ? `<div class="cmp-days">📅 可用约 ${d} 天</div>` : ''; })()}
        </div>
        ${!p.builtin ? `<button class="cmp-del" data-del="${p.id}" aria-label="删除">🗑</button>` : ''}
      </div>`;
    }).join('');

    const anyDays = ranked.some(p => daysFor(p) != null);
    const consBar = `<button class="cons-bar" id="compare-cons">⚙️ ${anyDays ? '修改消耗参数（可食用天数）' : '设置消耗参数，查看各商品可使用天数'} ›</button>`;
    content.innerHTML = `
      ${consBar}
      <div class="recommend-card">
        <div class="rc-label">✨ 智能推荐</div>
        <div class="rc-main">🏆 ${escapeHtml(best.brand)} ${escapeHtml(best.name)}</div>
        <div class="rc-reason">${recommend}</div>
      </div>
      ${stats}
      <div class="cmp-section-title">📋 单位价格排名（越低越划算）</div>
      <div class="cmp-list">${items}</div>
      <div class="cmp-note">说明：单位价格 = 该商品最低<b>到手价</b> ÷ 规格总数量（奶粉按克、纸尿裤按片、加油按升），已计入满减/折扣等优惠。规格支持「800g×3罐+赠1罐」自动算总量。价格均来自你的录入，请以实际平台为准。点 🗑 可删除录入的商品。</div>`;

    content.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => deleteProduct(btn.dataset.del));
    });
    const cb = $('#compare-cons');
    if (cb) cb.addEventListener('click', () => openConsumption(cat));
  }

  // ---------- 数据加载 ----------
  async function reload() {
    products = await dataSource.fetchPrices();
  }

  // ---------- 事件绑定 ----------
  function bindEvents() {
    $$('.nav-item').forEach(n => n.addEventListener('click', () => {
      state.onlyMine = false;
      navigate(n.dataset.page);
    }));
    $('#list-back').addEventListener('click', () => {
      state.onlyMine = false;
      navigate(listReturnPage);
    });
    $('#detail-back').addEventListener('click', () => navigate(detailReturnPage));
    $('#editor-back').addEventListener('click', () => navigate(editorReturnPage));
    $('#compare-back').addEventListener('click', () => navigate('list'));

    // 搜索（仅列表页）
    searchInput.addEventListener('input', () => {
      state.query = searchInput.value;
      searchClear.hidden = !state.query;
      if (state.page !== 'list') navigate('list');
      renderList();
    });
    searchClear.addEventListener('click', () => {
      searchInput.value = ''; state.query = ''; searchClear.hidden = true; renderList();
    });

    // 录入 / 对比按钮
    $('#list-add').addEventListener('click', () => openEditor(null));
    $('#list-compare').addEventListener('click', () => navigate('compare'));
    $('#me-my-products').addEventListener('click', openMyProducts);
    $('#add-platform-row').addEventListener('click', () => {
      const allowed = dataSource.getPlatformOptions($('#edit-category').value);
      const used = $$('#platform-rows .prow-key').map(s => s.value);
      const next = allowed.find(k => !used.includes(k)) || allowed[0];
      addPlatformRow(next, '', '');
    });
    $('#edit-category').addEventListener('change', (e) => {
      syncPlatformOptionsForCategory(e.target.value);
      loadSpecBuilder(null); // 切换品类重置规格字段
    });
    ['#buy-packs', '#per-pack', '#gift-packs', '#gift-per'].forEach(sel => {
      const el = $(sel); if (el) el.addEventListener('input', recalcSpecBuilder);
    });
    $('#gift-switch').addEventListener('click', () => {
      setGiftSwitch(!giftEnabled());
      recalcSpecBuilder();
    });
    $('#editor-form').addEventListener('submit', submitEditor);
    $('#editor-delete').addEventListener('click', deleteEditorProduct);
    $('#editor-consumption').addEventListener('click', () => openConsumption(
      ['milk', 'diaper', 'fuel'].includes($('#edit-category').value) ? $('#edit-category').value : 'milk'
    ));
    // 消耗参数弹层
    $$('.cons-tab').forEach(t => t.addEventListener('click', () => switchConsTab(t.dataset.cat)));
    $('#cons-save').addEventListener('click', saveConsumption);
    $('#cons-cancel').addEventListener('click', () => $('#consumption-mask').hidden = true);
    $('#consumption-mask').addEventListener('click', (e) => { if (e.target.id === 'consumption-mask') $('#consumption-mask').hidden = true; });

    // 截图识别
    $('#ocr-entry').addEventListener('click', openOcrDialog);
    $('#ocr-file').addEventListener('change', (e) => handleOcrFile(e.target.files && e.target.files[0]));
    $('#ocr-cancel').addEventListener('click', () => { $('#ocr-mask').hidden = true; });
    $('#ocr-mask').addEventListener('click', (e) => { if (e.target.id === 'ocr-mask') $('#ocr-mask').hidden = true; });
    $('#ocr-recapture').addEventListener('click', () => { $('#ocr-file').value = ''; $('#ocr-file').click(); });
    $('#ocr-apply').addEventListener('click', applyOcrResult);

    // 排序
    $('#sort-btn').addEventListener('click', () => {
      $$('.sheet-option').forEach(o => o.classList.toggle('selected', o.dataset.sort === state.sort));
      $('#sort-mask').hidden = false;
    });
    $('#sort-cancel').addEventListener('click', () => $('#sort-mask').hidden = true);
    $('#sort-mask').addEventListener('click', e => { if (e.target.id === 'sort-mask') $('#sort-mask').hidden = true; });
    $$('.sheet-option').forEach(o => o.addEventListener('click', () => {
      state.sort = o.dataset.sort;
      $('#sort-label').textContent =
        { default: '默认排序', 'price-asc': '价格最低', 'save-desc': '省钱最多', time: '最近更新' }[state.sort];
      $('#sort-mask').hidden = true;
      renderList();
    }));

    // 提醒弹层
    $('#alert-save').addEventListener('click', saveAlert);
    $('#alert-cancel').addEventListener('click', () => $('#alert-mask').hidden = true);
    $('#alert-mask').addEventListener('click', e => { if (e.target.id === 'alert-mask') $('#alert-mask').hidden = true; });

    // 我的页
    $('#me-alerts').addEventListener('click', () => {
      const ids = Object.keys(Store.data.alerts);
      if (!ids.length) { toast('还没有设置降价提醒'); return; }
      const lines = ids.map(id => {
        const p = products.find(x => x.id === id);
        return p ? `${p.brand}${p.name} → ${priceLabel(p, Store.data.alerts[id].target)}` : '';
      }).filter(Boolean);
      alert('当前降价提醒：\n\n' + lines.join('\n'));
    });
    $('#me-clear').addEventListener('click', () => {
      const n = dataSource.listUserProducts().length;
      if (!confirm(`确定清除所有收藏、提醒和 ${n} 个录入商品？此操作不可恢复。`)) return;
      dataSource.listUserProducts().forEach(x => dataSource.deleteUserProduct(x.id));
      Store.clearPrefs();
      reload().then(() => {
        renderFavorites(); updateAlertCount(); updateMyProductCount();
        toast('已清除本地数据');
      });
    });

    // 安装提示
    $('#install-close').addEventListener('click', () => {
      $('#install-banner').hidden = true;
      Store.data.installsDismissed = true; Store.save();
    });
    $('#install-btn').addEventListener('click', () => {
      if (window.deferredPrompt) {
        window.deferredPrompt.prompt();
        window.deferredPrompt.userChoice.then(() => { window.deferredPrompt = null; $('#install-banner').hidden = true; });
      } else toast('请点击浏览器菜单 → 添加到主屏幕');
    });
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); window.deferredPrompt = e;
      if (!Store.data.installsDismissed) $('#install-banner').hidden = false;
    });

    // 安卓物理返回键
    window.addEventListener('popstate', () => {
      const sm = $('#sort-mask'), am = $('#alert-mask'), om = $('#ocr-mask'), cm = $('#consumption-mask');
      if (!sm.hidden) { sm.hidden = true; return; }
      if (!am.hidden) { am.hidden = true; return; }
      if (!om.hidden) { om.hidden = true; return; }
      if (!cm.hidden) { cm.hidden = true; return; }
      if (state.page === 'detail') { navigate(detailReturnPage); return; }
      if (state.page === 'editor') { navigate(editorReturnPage); return; }
      if (state.page === 'compare') { navigate('list'); return; }
      if (state.page === 'list') { state.onlyMine = false; navigate(listReturnPage); return; }
      if (state.page !== 'home') { navigate('home'); return; }
      history.pushState(null, '', '');
    });
    history.pushState(null, '', '');
  }

  // ---------- 启动 ----------
  async function init() {
    bindEvents();
    try {
      await reload();
      navigate('home');
    } catch (e) {
      $('#entry-grid').innerHTML = '<div class="empty-state"><p>数据加载失败</p><span>请刷新重试</span></div>';
      console.error(e);
    }
  }

  if ('serviceWorker' in navigator) {
    // 用相对当前目录的绝对 URL 注册，兼容 GitHub Pages 子路径部署（/用户名/仓库名/）
    const swUrl = new URL('sw.js', document.baseURI).href;
    window.addEventListener('load', () => navigator.serviceWorker.register(swUrl).catch(() => {}));
  }

  init();
})();
