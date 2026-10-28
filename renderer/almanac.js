(() => {
  const fallback = date => ({
    lunar: '农历日期计算中',
    day: `${date.getFullYear()}年 · 本地日历`,
    festival: '今日暂无传统节日',
    yi: ['整理', '学习', '沟通'],
    ji: ['熬夜', '拖延', '冲动决定']
  });

  window.dayanAlmanac = date => {
    if (!window.Solar) return fallback(date);
    try {
      const solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
      const lunar = solar.getLunar();
      const festivals = lunar.getFestivals();
      const jieQi = lunar.getJieQi();
      const lunarDay = `农历${lunar.toString().replace(/^.*?年/, '')}`;
      const festival = [...festivals, jieQi].filter(Boolean).join(' · ') || '今日暂无传统节日';
      return {
        lunar: lunarDay,
        day: `${lunar.getYearInGanZhi()}年 · ${lunar.getDayInGanZhi()}日 · 生肖${lunar.getDayShengXiao()}`,
        festival,
        yi: lunar.getDayYi().slice(0, 6),
        ji: lunar.getDayJi().slice(0, 6)
      };
    } catch (error) {
      console.warn('Unable to calculate almanac:', error);
      return fallback(date);
    }
  };
})();
