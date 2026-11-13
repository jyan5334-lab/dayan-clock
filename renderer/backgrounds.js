window.timerBackgrounds = [
  {
    "id": "mountains",
    "label": "暗夜山峦",
    "src": "assets/backgrounds/mountains.webp"
  },
  {
    "id": "lunar",
    "label": "寂静月面",
    "src": "assets/backgrounds/lunar.webp"
  },
  {
    "id": "ocean",
    "label": "午夜海潮",
    "src": "assets/backgrounds/ocean.webp"
  },
  {
    "id": "vault",
    "label": "混凝土秘境",
    "src": "assets/backgrounds/vault.webp"
  },
  {
    "id": "basalt",
    "label": "熔岩余烬",
    "src": "assets/backgrounds/basalt.webp"
  },
  {
    "id": "forest",
    "label": "雨后深林",
    "src": "assets/backgrounds/forest.webp"
  },
  {
    "id": "silk",
    "label": "绯红绸幕",
    "src": "assets/backgrounds/silk.webp"
  },
  {
    "id": "crystal",
    "label": "冰晶棱镜",
    "src": "assets/backgrounds/crystal.webp"
  },
  {
    "id": "dunes",
    "label": "银月沙丘",
    "src": "assets/backgrounds/dunes.webp"
  },
  {
    "id": "city",
    "label": "雨夜都市",
    "src": "assets/backgrounds/city.webp"
  },
  {
    "id": "galactic-vault",
    "label": "银河穹顶",
    "src": "assets/backgrounds/galactic-vault.png"
  },
  {
    "id": "titanium-hangar",
    "label": "钛银机库",
    "src": "assets/backgrounds/titanium-hangar.png"
  },
  {
    "id": "abyssal-sanctuary",
    "label": "深海遗迹",
    "src": "assets/backgrounds/abyssal-sanctuary.png"
  },
  {
    "id": "polar-silence",
    "label": "极夜雪境",
    "src": "assets/backgrounds/polar-silence.png"
  },
  {
    "id": "emerald-sanctuary",
    "label": "翡翠秘境",
    "src": "assets/backgrounds/emerald-sanctuary.png"
  },
  {
    "id": "rose-silk",
    "label": "玫瑰星纱",
    "src": "assets/backgrounds/rose-silk.png"
  },
  {
    "id": "moonlit-garden",
    "label": "月下花庭",
    "src": "assets/backgrounds/moonlit-garden.png"
  },
  {
    "id": "prismatic-glass",
    "label": "流光琉璃",
    "src": "assets/backgrounds/prismatic-glass.png"
  },
  {
    "id": "obsidian-dunes",
    "label": "金曜沙海",
    "src": "assets/backgrounds/obsidian-dunes.png"
  },
  {
    "id": "neon-rain",
    "label": "雨夜霓城",
    "src": "assets/backgrounds/neon-rain.png"
  },
  {
    "id": "hacker-matrix",
    "label": "黑客矩阵",
    "group": "黑客动态",
    "kind": "html",
    "src": "assets/backgrounds/hacker/hacker-wallpaper.html?skin=matrix&embed=1&quiet=1",
    "thumb": "assets/backgrounds/hacker/preview-matrix.png"
  },
  {
    "id": "hacker-cyber",
    "label": "黑客赛博",
    "group": "黑客动态",
    "kind": "html",
    "src": "assets/backgrounds/hacker/hacker-wallpaper.html?skin=cyber&embed=1&quiet=1",
    "thumb": "assets/backgrounds/hacker/preview-cyber.png"
  },
  {
    "id": "hacker-amber",
    "label": "黑客琥珀",
    "group": "黑客动态",
    "kind": "html",
    "src": "assets/backgrounds/hacker/hacker-wallpaper.html?skin=amber&embed=1&quiet=1",
    "thumb": "assets/backgrounds/hacker/preview-amber.png"
  },
  {
    "id": "hacker-crimson",
    "label": "黑客猩红",
    "group": "黑客动态",
    "kind": "html",
    "src": "assets/backgrounds/hacker/hacker-wallpaper.html?skin=crimson&embed=1&quiet=1",
    "thumb": "assets/backgrounds/hacker/preview-crimson.png"
  },
  {
    "id": "hacker-violet",
    "label": "黑客紫电",
    "group": "黑客动态",
    "kind": "html",
    "src": "assets/backgrounds/hacker/hacker-wallpaper.html?skin=violet&embed=1&quiet=1",
    "thumb": "assets/backgrounds/hacker/preview-violet.png"
  },
  {
    "id": "pelican-bike",
    "label": "鹈鹕骑行",
    "group": "动态背景",
    "kind": "html",
    "perDisplay": true,
    "src": "assets/backgrounds/dynamic/animation.html?scene=pelican-bike",
    "thumb": "assets/backgrounds/dynamic/preview-pelican-bike.png"
  },
  {
    "id": "pelican-seaside",
    "label": "海边日落骑行",
    "group": "动态背景",
    "kind": "html",
    "perDisplay": true,
    "src": "assets/backgrounds/dynamic/animation.html?scene=pelican-seaside",
    "thumb": "assets/backgrounds/dynamic/preview-pelican-seaside.png"
  }
].map(item => ({ ...item, src: new URL(item.src, document.baseURI).href, thumb: item.thumb ? new URL(item.thumb, document.baseURI).href : undefined }));
