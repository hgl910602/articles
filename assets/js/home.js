/* 首页交互：搜索 + 标签筛选（由 build-index.mjs 生成的页面引用） */
(function () {
  var chips = document.querySelectorAll('.chip');
  var cards = document.querySelectorAll('.card');
  var search = document.getElementById('search');
  var empty = document.getElementById('empty');
  var activeTag = '';

  if (!chips.length || !cards.length) return;

  function apply() {
    var kw = (search && search.value || '').trim().toLowerCase();
    var visible = 0;
    cards.forEach(function (card) {
      var tagOk = !activeTag || card.dataset.tags.split(',').indexOf(activeTag) !== -1;
      var text = (card.dataset.title + ' ' + card.dataset.desc + ' ' + card.dataset.tags).toLowerCase();
      var kwOk = !kw || text.indexOf(kw) !== -1;
      var show = tagOk && kwOk;
      card.hidden = !show;
      if (show) visible++;
    });
    if (empty) empty.hidden = visible > 0;
  }

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      chips.forEach(function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
      activeTag = chip.dataset.tag;
      apply();
    });
  });

  if (search) {
    search.addEventListener('input', apply);
  }

  // 卡片上的标签点击 → 联动顶部筛选（不触发卡片跳转）
  cards.forEach(function (card) {
    card.querySelectorAll('.tag').forEach(function (tag) {
      tag.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var t = tag.dataset.tag;
        chips.forEach(function (c) { c.classList.toggle('active', c.dataset.tag === t); });
        activeTag = t;
        apply();
      });
    });
  });
})();
