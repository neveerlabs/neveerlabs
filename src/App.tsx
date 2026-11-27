import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type SVGProps,
} from "react";
import { flushSync } from "react-dom";
import {
  ArrowUpRight,
  Github,
  Instagram,
  Linkedin,
  Mail,
} from "lucide-react";
import type { Project } from "./types/projects";
import { AdminPage } from "./pages/AdminPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";

type Language = "en" | "zh";
type Page = "home" | "about" | "projects" | "project-detail" | "blog";
type PageNavigationHandler = (
  event: MouseEvent<HTMLAnchorElement>,
  page: Page,
  projectName?: string,
) => void;

const slideDirections = [
  {
    x: "102%",
    y: "0%",
    rotateX: "0deg",
    rotateY: "-8deg",
    origin: "100% 50%",
    shadow: "-32px 0 48px rgba(34, 36, 43, 0.24)",
  },
  {
    x: "-102%",
    y: "0%",
    rotateX: "0deg",
    rotateY: "8deg",
    origin: "0% 50%",
    shadow: "32px 0 48px rgba(34, 36, 43, 0.24)",
  },
  {
    x: "0%",
    y: "-102%",
    rotateX: "-8deg",
    rotateY: "0deg",
    origin: "50% 0%",
    shadow: "0 32px 48px rgba(34, 36, 43, 0.24)",
  },
  {
    x: "0%",
    y: "102%",
    rotateX: "8deg",
    rotateY: "0deg",
    origin: "50% 100%",
    shadow: "0 -32px 48px rgba(34, 36, 43, 0.24)",
  },
] as const;

function getLanguageFromPathname(pathname: string): Language | null {
  const firstPathSegment = pathname.split("/").filter(Boolean)[0];
  return firstPathSegment === "en" || firstPathSegment === "zh"
    ? firstPathSegment
    : null;
}

function getPageFromPathname(pathname: string): Page {
  const segments = pathname.split("/").filter(Boolean);
  const pageSegment = segments[1];
  if (pageSegment === "projects" && segments.length > 2) {
    return "project-detail";
  }
  return pageSegment === "about" || pageSegment === "projects" || pageSegment === "blog"
    ? pageSegment
    : "home";
}

function getProjectNameFromPathname(pathname: string): string | null {
  const slug = pathname.split("/").filter(Boolean)[2];
  if (!slug) return null;
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

function getLocalizedPath(
  language: Language,
  page: Page,
  projectName?: string | null,
): string {
  if (page === "home") return `/${language}/`;
  if (page === "project-detail") {
    return `/${language}/projects/${encodeURIComponent(projectName ?? "")}`;
  }
  return `/${language}/${page}`;
}

const copy = {
  en: {
    home: "Home",
    about: "About",
    projects: "Projects",
    blog: "Blog",
    getInTouch: "Get in touch",
    brandDescription: [
      "An independent personal brand.",
      "Exploring ideas, building software, and sharing technology for what comes next.",
    ],
    projectHeading: "Projects",
    projectItems: ["Cheya App", "e-Kitabku", "Fuzzer", "Interface", "Sara", "More..."],
    connect: "Connect",
  },
  zh: {
    home: "首页",
    about: "关于",
    projects: "项目",
    blog: "博客",
    getInTouch: "联系我",
    brandDescription: [
      "一个独立的个人品牌。",
      "探索想法、构建软件，并分享面向未来的技术。",
    ],
    projectHeading: "项目",
    projectItems: ["Cheya App", "e-Kitabku", "Fuzzer", "Interface", "Sara", "More..."],
    connect: "联系",
  },
} as const;

type HomePageCopy = {
  heroGreeting: string;
  heroNameFirst: string;
  heroNameLast: string;
  intro: string;
  blog: string;
  openBlog: string;
  badge: {
    role: string;
    specialtyLabel: string;
    specialtyValue: string;
    locationLabel: string;
    locationValue: string;
    experienceLabel: string;
    experienceValue: string;
    statusLabel: string;
    statusValue: string;
  };
};

const homeCopy: Record<Language, HomePageCopy> = {
  en: {
    heroGreeting: "Hi, I'm",
    heroNameFirst: "Muhammad Syalman",
    heroNameLast: "Al Farizi",
    intro:
      "I explore ideas and engineer software through Neverlabs. I build web and mobile applications alongside practical tools that turn useful ideas into reality.",
    blog: "Blog",
    openBlog: "Open blog",
    badge: {
      role: "Software & App Developer",
      specialtyLabel: "SPECIALTY",
      specialtyValue: "Web, Mobile & Tools",
      locationLabel: "LOCATION",
      locationValue: "Depok, Jawa Barat",
      experienceLabel: "EXPERIENCE",
      experienceValue: "Since 2023",
      statusLabel: "STATUS",
      statusValue: "Active",
    },
  },
  zh: {
    heroGreeting: "你好，我是",
    heroNameFirst: "Muhammad Syalman",
    heroNameLast: "Al Farizi",
    intro:
      "我通过 Neverlabs 探索想法并构建软件，专注于开发 Web 与移动应用程序以及实用的数字工具，把有价值的想法变成现实。",
    blog: "博客",
    openBlog: "前往博客",
    badge: {
      role: "软件与应用开发者",
      specialtyLabel: "专业领域",
      specialtyValue: "Web、移动应用与工具",
      locationLabel: "所在地",
      locationValue: "Depok, Jawa Barat",
      experienceLabel: "经验",
      experienceValue: "自 2023 年起",
      statusLabel: "状态",
      statusValue: "活跃",
    },
  },
} as const;

const pageTitles: Record<Language, Record<Page, string>> = {
  en: {
    home: "neverlabs — personal brand",
    about: "About — neverlabs",
    projects: "Projects — neverlabs",
    "project-detail": "Project — neverlabs",
    blog: "Blog — neverlabs",
  },
  zh: {
    home: "neverlabs — 个人品牌",
    about: "关于 — neverlabs",
    projects: "项目 — neverlabs",
    "project-detail": "项目 — neverlabs",
    blog: "博客 — neverlabs",
  },
};

type AboutPageCopy = {
  headline: string;
  narrative: string[];
  principles: { title: string; description: string }[];
  focusLabel: string;
  focusAreas: { title: string; description: string }[];
};

const aboutCopy: Record<Language, AboutPageCopy> = {
  en: {
    headline:
      "An independent space for exploring ideas and building useful software.",
    narrative: [
      "Neverlabs exists to turn curiosity into functional software, useful tools, and digital experiments—without adding unnecessary bloat.",
      "The work values clarity, thoughtful interfaces, and shipping real things over hype.",
    ],
    principles: [
      {
        title: "Explore First",
        description:
          "Experiment openly with technologies, systems, and ideas before settling into rigid patterns.",
      },
      {
        title: "Build Useful Things",
        description:
          "Focus on practical utility, clean architecture, and software that solves real problems.",
      },
      {
        title: "Keep It Calm",
        description:
          "Design interfaces and tools that feel quiet, fast, and intentional—free from visual noise.",
      },
    ],
    focusLabel: "Focus areas",
    focusAreas: [
      {
        title: "Software Engineering",
        description:
          "Designing and building reliable web applications, developer utilities, and lightweight tools from concept to deployment.",
      },
      {
        title: "Interface & Product Design",
        description:
          "Crafting minimal, responsive user interfaces where typography, spacing, and interaction feel natural.",
      },
      {
        title: "Technical Experiments",
        description:
          "Testing ideas around automation, security tooling, and emerging web capabilities through hands-on prototypes.",
      },
    ],
  },
  zh: {
    headline: "探索想法并构建实用软件的独立空间。",
    narrative: [
      "Neverlabs 致力于将好奇心转化为实用的软件、工具与数字实验，不堆砌不必要的复杂功能。",
      "这里重视清晰的思路、经过深思的界面，以及真正交付可用成果，而不是追逐噱头。",
    ],
    principles: [
      {
        title: "先探索，再定义",
        description: "先开放地尝试新技术、系统与想法，再决定是否将其沉淀为固定模式。",
      },
      {
        title: "构建真正有用的作品",
        description: "重视实际价值与清晰架构，专注于解决真实问题的软件。",
      },
      {
        title: "保持克制与清晰",
        description: "打造安静、快速且有明确目的的界面与工具，避免多余的视觉干扰。",
      },
    ],
    focusLabel: "专注领域",
    focusAreas: [
      {
        title: "软件工程",
        description: "从构想到部署，设计并构建可靠的 Web 应用、开发者工具与轻量级实用程序。",
      },
      {
        title: "界面与产品设计",
        description: "打造简洁、响应迅速的界面，让字体、间距与交互都自然协调。",
      },
      {
        title: "技术实验",
        description: "通过动手制作原型，探索自动化、安全工具与新兴 Web 技术的可能性。",
      },
    ],
  },
};

const pageCopy: Record<
  Language,
  Record<"projects" | "blog", { title: string; description: string[]; emptyState?: string }>
> = {
  en: {
    projects: {
      title: "Projects",
      description: [
        "A collection of projects and experiments connected to Neverlabs.",
        "Each one starts with an idea and grows through making.",
      ],
    },
    blog: {
      title: "Notes from Neverlabs",
      description: [
        "Writing about software, ideas, experiments, and technology.",
        "A place to share what I learn while turning ideas into useful things.",
      ],
      emptyState: "No posts published yet.",
    },
  },
  zh: {
    projects: {
      title: "项目",
      description: [
        "这里展示与 Neverlabs 相关的项目和实验。",
        "每个作品都从一个想法开始，并在实践中逐步成长。",
      ],
    },
    blog: {
      title: "Neverlabs 笔记",
      description: [
        "分享关于软件、想法、实验和技术的记录。",
        "记录把想法变成实用作品时的发现与思考。",
      ],
      emptyState: "目前还没有发布文章。",
    },
  },
};

const githubProfile = "https://github.com/neveerlabs/";
const emailAddress = "mailto:neverlabs4@gmail.com";
const privacyHref = `${emailAddress}?subject=Privacy`;
const termsHref = `${emailAddress}?subject=Terms`;

type ContactIconProps = SVGProps<SVGSVGElement> & { size?: number | string };

function ThreadsIcon({ size = 24, ...props }: ContactIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M18.263 11.097c-.03-3.486-1.92-5.586-5.111-5.586-2.13 0-3.922.963-4.863 2.499l2.062 1.438c.535-.843 1.272-1.543 2.628-1.543 1.528 0 2.318.85 2.544 2.431a15 15 0 0 0-2.236-.173c-4.125 0-6.068 1.867-6.068 4.336s1.943 3.99 4.804 3.99c3.139 0 5.013-2.115 5.781-4.735.798.361 1.348 1.204 1.348 2.47 0 3.387-3.907 5.232-7.22 5.232-4.885 0-8.077-3.207-8.077-8.424 0-6.392 4.223-10.487 9.9-10.487 3.808 0 5.69 1.671 6.97 3.914l2.108-1.475C21.44 2.078 18.331 0 13.663 0 6.227 0 1.168 5.277 1.168 12.934c0 7 4.953 11.066 10.856 11.066 4.878 0 9.809-2.846 9.809-7.716 0-2.545-1.46-4.231-3.569-5.187m-6.33 4.855c-1.077 0-2.026-.512-2.026-1.453 0-1.483 1.822-1.934 3.606-1.934.678 0 1.34.045 1.927.173-.422 1.927-1.671 3.215-3.508 3.214Z" />
    </svg>
  );
}

const contacts = [
  {
    label: "Email",
    href: emailAddress,
    Icon: Mail,
  },
  {
    label: "Threads",
    href: "https://www.threads.com/@neveerlabs",
    Icon: ThreadsIcon,
  },
  {
    label: "Instagram",
    href: "https://www.instagram.com/neveerlabs/",
    Icon: Instagram,
  },
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/in/neverlabs/",
    Icon: Linkedin,
  },
  {
    label: "GitHub",
    href: githubProfile,
    Icon: Github,
  },
];

function Brand({ href }: { href: string }) {
  return (
    <a className="brand" href={href} aria-label="neverlabs home">
      <img className="brand-logo" src="/images/logo.png" alt="neverlabs" />
    </a>
  );
}

const deviconUrl = (icon: string) =>
  `https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/${icon}/${icon}-original.svg`;

const techStack = [
  { name: "HTML5", icon: "html5" },
  { name: "CSS3", icon: "css3" },
  { name: "JavaScript", icon: "javascript" },
  { name: "TypeScript", icon: "typescript" },
  { name: "React", icon: "react" },
  { name: "Next.js", icon: "nextjs" },
  { name: "Vite", icon: "vitejs" },
  { name: "Tailwind CSS", icon: "tailwindcss" },
  { name: "Flutter", icon: "flutter" },
  { name: "Node.js", icon: "nodejs" },
  { name: "Express.js", icon: "express" },
  { name: "Python", icon: "python" },
  { name: "aiogram", icon: "python" },
  { name: "Gemini API", icon: "google" },
  { name: "Supabase", icon: "supabase" },
  { name: "PostgreSQL", icon: "postgresql" },
  { name: "MySQL", icon: "mysql" },
  { name: "SQLite", icon: "sqlite" },
  { name: "Three.js", icon: "threejs" },
  { name: "Linux", icon: "linux" },
] as const;

function TechMarquee({ language }: { language: Language }) {
  return (
    <section
      aria-label={language === "en" ? "Technology stack" : "技术栈"}
      className="relative z-10 mt-8 w-full overflow-hidden py-5 md:mt-10 md:py-6"
    >
      <h2 className="sr-only">
        {language === "en" ? "Languages and tools" : "编程语言与工具"}
      </h2>
      <div className="relative flex w-full items-center overflow-hidden">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-20 bg-gradient-to-r from-[#faf9f8] to-transparent md:w-32" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-20 bg-gradient-to-l from-[#faf9f8] to-transparent md:w-32" />
        <div className="tech-marquee-track flex w-max items-center whitespace-nowrap py-1 hover:[animation-play-state:paused]">
          {[0, 1].map((copy) => (
            <div
              aria-hidden={copy === 1}
              className="flex shrink-0 items-center gap-3 px-3"
              key={copy}
            >
              {techStack.map((technology) => (
                <span
                  className="inline-flex shrink-0 cursor-default items-center gap-3 rounded-full border border-[#e6e5e3] bg-white px-4 py-2 text-xs font-medium text-[#22242b] shadow-[0_2px_8px_rgba(34,36,43,0.04)] transition-transform hover:scale-105 md:text-sm"
                  key={technology.name}
                >
                  <img
                    alt=""
                    aria-hidden="true"
                    className="h-5 w-5 object-contain"
                    decoding="async"
                    loading="lazy"
                    src={deviconUrl(technology.icon)}
                  />
                  <span className="tracking-wide">{technology.name}</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function LanyardCard({ language }: { language: Language }) {
  const text = homeCopy[language].badge;
  const svgId = useId().replace(/:/g, "");
  const metadata = [
    [text.specialtyLabel, text.specialtyValue],
    [text.locationLabel, text.locationValue],
    [text.experienceLabel, text.experienceValue],
    [text.statusLabel, text.statusValue],
  ];

  return (
    <div className="relative mx-auto w-full max-w-[360px] pt-[34px]">
      <div className="relative mx-auto block w-[min(310px,calc(100vw-32px))] cursor-default select-none sm:w-[340px]">
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-[-34px] z-30 h-[44px] w-12 -translate-x-1/2 overflow-visible"
          fill="none"
          viewBox="0 0 48 44"
        >
          <defs>
            <linearGradient id={`${svgId}-stub`} x1="18" x2="30" y1="0" y2="14">
              <stop stopColor="#09090b" />
              <stop offset="0.45" stopColor="#3f3f46" />
              <stop offset="1" stopColor="#18181b" />
            </linearGradient>
            <linearGradient id={`${svgId}-steel`} x1="13" x2="35" y1="12" y2="22">
              <stop stopColor="#71717a" />
              <stop offset="0.45" stopColor="#3f3f46" />
              <stop offset="1" stopColor="#18181b" />
            </linearGradient>
            <linearGradient id={`${svgId}-hook`} x1="20" x2="29" y1="22" y2="39">
              <stop stopColor="#71717a" />
              <stop offset="0.45" stopColor="#27272a" />
              <stop offset="0.75" stopColor="#52525b" />
              <stop offset="1" stopColor="#18181b" />
            </linearGradient>
          </defs>
          <rect
            x="18"
            y="0"
            width="12"
            height="14"
            rx="2"
            fill={`url(#${svgId}-stub)`}
            stroke="#09090b"
            strokeWidth="0.8"
          />
          <path d="M20 2v10m2-10v10m4-10v10" stroke="#a1a1aa" strokeOpacity="0.22" strokeWidth="0.6" />
          <rect
            x="13"
            y="12"
            width="22"
            height="10"
            rx="2.5"
            fill={`url(#${svgId}-steel)`}
            stroke="#18181b"
            strokeWidth="0.8"
          />
          <path d="M15 14h18" stroke="#d4d4d8" strokeOpacity="0.35" strokeWidth="0.7" />
          <circle cx="18" cy="17" r="1.25" fill="#d4d4d8" stroke="#18181b" strokeWidth="0.5" />
          <circle cx="30" cy="17" r="1.25" fill="#71717a" stroke="#09090b" strokeWidth="0.5" />
          <path
            d="M21 22v2c0 1.8 1.3 3.2 3 3.2s3-1.4 3-3.2v-2"
            stroke={`url(#${svgId}-steel)`}
            strokeLinecap="round"
            strokeWidth="2.5"
          />
          <path
            d="M21.5 25.5v6.8c0 3.8 1.1 6.7 2.5 6.7s2.5-2.9 2.5-6.7v-4.1c0-2-1-3.2-2.5-3.2s-2.5 1.2-2.5 3.2v2"
            stroke={`url(#${svgId}-hook)`}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="3"
          />
          <path d="M27.5 28.5 24.5 31" stroke="#a1a1aa" strokeLinecap="round" strokeWidth="0.8" />
        </svg>

        <div className="relative h-[430px] w-full overflow-hidden rounded-[24px] border border-[#e6e5e3] bg-white shadow-[0_20px_50px_rgba(34,36,43,0.10)]">
          <div className="relative h-[118px]">
            <div aria-hidden="true" className="id-card-cover absolute inset-0">
              <svg
                className="id-card-dot-field"
                preserveAspectRatio="none"
                viewBox="0 0 340 118"
              >
                {Array.from({ length: 8 }, (_, row) =>
                  Array.from({ length: 25 }, (_, column) => (
                    <circle
                      className="id-card-dot"
                      cx={6 + column * 13.7}
                      cy={5 + row * 15.4}
                      key={`${row}-${column}`}
                      r="1.7"
                      style={{
                        animationDelay: `${column * 0.16}s`,
                      }}
                    />
                  )),
                )}
              </svg>
              <span
                aria-hidden="true"
                className="absolute left-1/2 top-1.5 z-20 h-1.5 w-9 -translate-x-1/2 rounded-full bg-[#18181b]"
              />
            </div>
            <img
              alt="Muhammad Syalman Al Farizi"
              className="absolute -bottom-[38px] left-1/2 z-20 h-[76px] w-[76px] shrink-0 -translate-x-1/2 rounded-full border-[3px] border-white object-cover shadow-md"
              src="/images/image.jpeg"
            />
          </div>

          <div className="px-5 pb-4 pt-[48px] text-center">
            <p className="text-[15px] font-extrabold leading-tight tracking-tight text-[#18181b]">
              M. Syalman Al Farizi
            </p>
            <p className="mt-1 inline-block rounded-full border border-[#d4d4d8] bg-white px-3.5 py-0.5 text-[11px] font-semibold text-[#18181b]">
              {text.role}
            </p>
            <div className="mt-3 border-t-[1.5px] border-[#18181b]" />

            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-[#e4e4e7] p-3.5 text-left">
              {metadata.map(([label, value]) => (
                <div key={label}>
                  <p className="text-[8px] font-semibold tracking-[0.1em] text-[#9a9ba0]">
                    {label}
                  </p>
                  <p className="mt-1 flex items-center gap-1 text-[10px] font-medium text-[#22242b]">
                    {label === text.statusLabel && (
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 rounded-full bg-[#10b981]"
                      />
                    )}
                    {value}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-3 flex h-7 w-full items-end justify-center gap-[2.5px] rounded-lg border border-[#e4e4e7] bg-white/90 px-3 py-0.5">
              {Array.from({ length: 36 }, (_, index) => (
                <span
                  key={index}
                  aria-hidden="true"
                  className="shrink-0 rounded-[1px] bg-[#18181b]"
                  style={{
                    width: index % 4 === 0 ? "3.5px" : index % 2 === 0 ? "2px" : "1px",
                    height: `${50 + Math.sin(index * 1.4) * 45}%`,
                  }}
                />
              ))}
            </div>

            <div className="mt-2 flex items-center justify-between text-[9px] font-semibold tracking-[0.08em]">
              <span className="text-[#18181b]">SR-89240-PRO</span>
              <span className="text-[#9a9ba0]">LIGHTSWIND UI</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AuroraName({ text }: { text: string }) {
  return (
    <span className="home-aurora-text block w-fit select-none">
      <span className="home-aurora-base">{text}</span>
      <span aria-hidden="true" className="home-aurora-overlay">
        {text}
      </span>
    </span>
  );
}

function HomePage({
  language,
  onNavigate,
}: {
  language: Language;
  onNavigate: PageNavigationHandler;
}) {
  const text = homeCopy[language];
  const blogHref = getLocalizedPath(language, "blog");

  return (
    <div className="pb-6 md:pb-8">
      <div className="home-hero-canvas relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen">
        <div className="relative z-10 mx-auto w-full max-w-[1260px] px-2 pt-0 pb-2 md:px-4">
          <section
            aria-labelledby="home-title"
            className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[1fr_340px] lg:gap-7"
          >
            <div className="mt-6 md:mt-10">
              <h1
                className="text-[30px] font-extrabold leading-[1.08] tracking-[-0.03em] sm:text-[46px] md:text-[64px]"
                id="home-title"
              >
                <span className="block text-[#18181b]">{text.heroGreeting}</span>
                <AuroraName text={text.heroNameFirst} />
                <AuroraName text={text.heroNameLast} />
              </h1>
              <p className="mt-5 max-w-[520px] text-[15px] leading-[1.68] text-[#6d6e73] md:text-[17px]">
                {text.intro}
              </p>
              <nav
                aria-label={language === "en" ? "Contact links" : "联系方式"}
                className="social-links home-social-links mt-6 flex items-center gap-5"
              >
                {contacts.map(({ label, href, Icon }) => (
                  <a
                    href={href}
                    key={label}
                    aria-label={label}
                    title={label}
                    target={href.startsWith("https://") ? "_blank" : undefined}
                    rel={href.startsWith("https://") ? "noreferrer" : undefined}
                  >
                    <Icon size={20} strokeWidth={1.8} />
                  </a>
                ))}
              </nav>
            </div>

            <div className="flex justify-center lg:justify-end">
              <LanyardCard language={language} />
            </div>
          </section>
        </div>
        <TechMarquee language={language} />
      </div>

      <div className="home-content-frame">
        <section className="mt-6 pt-4 md:mt-8 md:pt-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-base font-medium text-[#22242b]">{text.blog}</h2>
            <a
              className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-[#22242b]"
              href={blogHref}
              onClick={(event) => onNavigate(event, "blog")}
            >
              {text.openBlog}
              <ArrowUpRight size={15} strokeWidth={1.7} />
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}

function AboutPage({ language }: { language: Language }) {
  const text = aboutCopy[language];

  return (
    <div className="about-page mx-auto w-full max-w-[980px] px-2 pt-2 pb-4 md:max-w-none md:px-0 md:pt-0 md:pb-8">
      <section
        aria-labelledby="about-title"
        className="max-w-4xl px-2.5 md:px-6"
      >
        <h1
          id="about-title"
          className="text-[28px] font-bold leading-[1.18] tracking-[-0.025em] text-[#22242b] md:text-[44px] md:leading-[1.12] md:tracking-[-0.03em]"
        >
          {text.headline}
        </h1>
        <div className="mt-4 space-y-4 md:mt-5 md:space-y-5">
          {text.narrative.map((paragraph) => (
            <p
              className="text-[15px] leading-[1.65] text-[#6d6e73] md:text-[17px] md:leading-[1.68]"
              key={paragraph}
            >
              {paragraph}
            </p>
          ))}
        </div>
      </section>

      <section
        aria-label={language === "en" ? "Core principles" : "核心原则"}
        className="mt-8 border-t border-[#e6e5e3] px-2.5 pt-6 md:mt-14 md:px-6 md:pt-9"
      >
        <h2 className="sr-only">
          {language === "en" ? "Core principles" : "核心原则"}
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-10">
          {text.principles.map((principle) => (
            <article
              className="md:border-b-0 md:pb-0"
              key={principle.title}
            >
              <h3 className="mb-2 text-lg font-semibold text-[#22242b]">
                {principle.title}
              </h3>
              <p className="text-sm leading-relaxed text-[#76777c]">
                {principle.description}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="focus-areas-title"
        className="mt-8 border-t border-[#e6e5e3] px-2.5 pt-6 md:mt-8 md:grid md:grid-cols-[200px_1fr] md:gap-10 md:px-6 md:pt-6"
      >
        <div>
          <h2
            id="focus-areas-title"
            className="mb-4 text-xs font-medium uppercase tracking-[0.12em] text-[#9a9ba0] md:mb-0"
          >
            {text.focusLabel}
          </h2>
        </div>
        <div>
          {text.focusAreas.map((area) => (
            <div
              className="py-2 first:pt-0 last:pb-0 md:grid md:grid-cols-[220px_1fr] md:items-baseline md:gap-8 md:border-b md:border-[#e6e5e3] md:py-5 md:first:pt-0 md:last:border-b-0 md:last:pb-5"
              key={area.title}
            >
              <h3 className="text-base font-medium text-[#22242b]">
                {area.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[#76777c] md:mt-0">
                {area.description}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function PageSections({
  language,
  page,
  onNavigate,
  project,
  projects,
  projectsLoading,
  projectsError,
  onProjectNavigate,
  onProjectsBack,
}: {
  language: Language;
  page: Page;
  onNavigate: PageNavigationHandler;
  project: Project | null;
  projects: Project[];
  projectsLoading: boolean;
  projectsError: string | null;
  onProjectNavigate: (name: string) => void;
  onProjectsBack: () => void;
}) {
  const sectionClass =
    "mx-auto flex min-h-[calc(100vh-88px)] w-full max-w-4xl -translate-y-8 flex-col items-center justify-center px-5 py-10 text-center md:min-h-[calc(100vh-95px)] md:-translate-y-10 md:px-8 md:py-24";

  if (page === "about") {
    return <AboutPage language={language} />;
  }

  if (page === "home") {
    return <HomePage language={language} onNavigate={onNavigate} />;
  }

  if (page === "projects") {
    if (projectsError) {
      return (
        <div className="mx-auto w-full max-w-[1120px] px-4 py-16 text-sm text-red-700 md:px-8">
          {language === "en"
            ? "Projects could not be loaded. Please try again later."
            : "项目加载失败，请稍后重试。"}
        </div>
      );
    }
    if (projectsLoading) {
      return (
        <div aria-live="polite" className="mx-auto min-h-[50vh] w-full max-w-5xl px-5 py-20 text-sm text-[#76777c]">
          {language === "en" ? "Loading projects…" : "正在加载项目…"}
        </div>
      );
    }
    return (
      <ProjectsPage
        language={language}
        onNavigate={onProjectNavigate}
        projects={projects}
      />
    );
  }

  if (page === "project-detail") {
    return (
      <ProjectDetailPage
        error={projectsError}
        language={language}
        loading={projectsLoading}
        onBack={onProjectsBack}
        project={project}
      />
    );
  }

  const text = pageCopy[language][page];

  return (
    <div className="home-content w-full bg-[#faf9f8]">
      <section aria-labelledby="page-title" className={sectionClass}>
        <h1
          id="page-title"
          className="max-w-4xl text-4xl font-bold tracking-tight text-[#22242b] md:text-6xl"
        >
          {text.title}
        </h1>
        {text.description.map((line) => (
          <p
            className="mt-5 max-w-3xl text-lg leading-relaxed text-[#9a9ba0] md:mt-6 md:text-xl"
            key={line}
          >
            {line}
          </p>
        ))}
        {text.emptyState && (
          <p className="mt-8 rounded-full border border-[#e6e5e3] bg-white px-5 py-2 text-sm text-[#76777c]">
            {text.emptyState}
          </p>
        )}
      </section>
    </div>
  );
}

function PortfolioApp() {
  const [language, setLanguage] = useState<Language>(
    () => getLanguageFromPathname(window.location.pathname) ?? "en",
  );
  const [currentPage, setCurrentPage] = useState<Page>(
    () => getPageFromPathname(window.location.pathname),
  );
  const [projectName, setProjectName] = useState<string | null>(
    () => getProjectNameFromPathname(window.location.pathname),
  );
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const lastSlideDirection = useRef<number | null>(null);
  const routeRef = useRef({ language, page: currentPage, projectName });
  const hasLoadedProjects = useRef(false);
  const text = copy[language];
  const isChinese = language === "zh";

  useEffect(() => {
    const title =
      currentPage === "project-detail" && selectedProject
        ? `${selectedProject.name} — ${language === "en" ? "Projects" : "项目"} — neverlabs`
        : pageTitles[language][currentPage];
    const description =
      currentPage === "project-detail" && selectedProject
        ? selectedProject.description?.[language] ||
          selectedProject.description?.en ||
          ""
        : currentPage === "home"
          ? language === "en"
            ? "Muhammad Syalman Al Farizi — exploring ideas and engineering software, web & mobile applications, and practical tools through Neverlabs."
            : homeCopy.zh.intro
          : currentPage === "about"
            ? aboutCopy[language].narrative.join(" ")
            : currentPage === "projects" || currentPage === "project-detail"
              ? language === "en"
                ? "Explore projects and software experiments by Neverlabs."
                : "探索 Neverlabs 的项目与软件实验。"
              : pageCopy[language].blog.description.join(" ");
    const canonicalPath = getLocalizedPath(
      language,
      currentPage,
      projectName,
    );
    const canonicalUrl = `${window.location.origin}${canonicalPath}`;
    const projectImage =
      currentPage === "project-detail" &&
      selectedProject?.primary_media &&
      !/\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(selectedProject.primary_media)
        ? selectedProject.primary_media
        : null;
    const imageUrl = projectImage
      ? new URL(projectImage, window.location.origin).href
      : `${window.location.origin}/images/og-preview.png`;

    document.title = title;
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";

    const canonicalLink =
      document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonicalLink) {
      throw new Error("Missing required canonical link element.");
    }
    canonicalLink.href = canonicalUrl;

    const metaContent: Record<string, string> = {
      'meta[name="description"]': description,
      'meta[property="og:url"]': canonicalUrl,
      'meta[property="og:title"]': title,
      'meta[property="og:description"]': description,
      'meta[property="og:image"]': imageUrl,
      'meta[property="og:image:secure_url"]': imageUrl,
      'meta[name="twitter:title"]': title,
      'meta[name="twitter:description"]': description,
      'meta[name="twitter:image"]': imageUrl,
    };

    for (const [selector, content] of Object.entries(metaContent)) {
      const meta = document.querySelector<HTMLMetaElement>(selector);
      if (!meta) {
        throw new Error(`Missing required metadata element: ${selector}`);
      }
      meta.content = content;
    }
  }, [language, currentPage, projectName, selectedProject]);

  useEffect(() => {
    if (currentPage !== "projects" && currentPage !== "project-detail") {
      setProjectsLoading(false);
      setProjectsError(null);
      return;
    }

    if (currentPage === "projects" && hasLoadedProjects.current) {
      setProjectsLoading(false);
      setProjectsError(null);
      return;
    }

    const controller = new AbortController();
    const endpoint =
      currentPage === "project-detail"
        ? `/api/projects?name=${encodeURIComponent(projectName ?? "")}`
        : "/api/projects";

    setProjectsLoading(true);
    setProjectsError(null);
    if (currentPage === "project-detail") setSelectedProject(null);
    void fetch(endpoint, { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404 && currentPage === "project-detail") {
          setSelectedProject(null);
          setProjectsError("not-found");
          return;
        }
        if (!response.ok) {
          throw new Error(`Projects API returned ${response.status}.`);
        }
        const data = (await response.json()) as Project | Project[];
        if (currentPage === "project-detail") {
          setSelectedProject(data as Project);
        } else {
          setProjects(data as Project[]);
          hasLoadedProjects.current = true;
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Unable to load project data:", error);
        setProjectsError("load-failed");
      })
      .finally(() => {
        if (!controller.signal.aborted) setProjectsLoading(false);
      });

    return () => controller.abort();
  }, [currentPage, projectName]);

  useEffect(() => {
    const initialLanguage =
      getLanguageFromPathname(window.location.pathname) ?? language;
    const initialPage = getPageFromPathname(window.location.pathname);
    const initialProjectName = getProjectNameFromPathname(
      window.location.pathname,
    );
    const initialPath = getLocalizedPath(
      initialLanguage,
      initialPage,
      initialProjectName,
    );
    const initialUrl = `${initialPath}${window.location.search}${window.location.hash}`;

    if (window.location.pathname !== initialPath) {
      window.history.replaceState(null, "", initialUrl);
    }

    routeRef.current = {
      language: initialLanguage,
      page: initialPage,
      projectName: initialProjectName,
    };

    const historyState = window.history.state;
    const hasAppHistoryEntry =
      typeof historyState === "object" &&
      historyState !== null &&
      "neverlabsRoute" in historyState;

    if (initialPage !== "home" && !hasAppHistoryEntry) {
      const fallbackPage = initialPage === "project-detail" ? "projects" : "home";
      const fallbackPath = getLocalizedPath(initialLanguage, fallbackPage);
      window.history.replaceState(
        { neverlabsRoute: fallbackPage },
        "",
        `${fallbackPath}${window.location.search}`,
      );
      window.history.pushState(
        { neverlabsRoute: initialPage },
        "",
        initialUrl,
      );
    }

    const handlePopState = (event: PopStateEvent) => {
      const state = event.state;
      const isKeywordPickerHistoryState =
        typeof state === "object" &&
        state !== null &&
        (("neverlabsKeywordPicker" in state &&
          state.neverlabsKeywordPicker === true) ||
          ("neverlabsKeywordPickerReturn" in state &&
            state.neverlabsKeywordPickerReturn === true));
      const isMediaLightboxState =
        typeof state === "object" &&
        state !== null &&
        "neverlabsMediaLightbox" in state &&
        state.neverlabsMediaLightbox === true;
      const isMediaLightboxReturnState =
        typeof state === "object" &&
        state !== null &&
        "neverlabsMediaLightboxReturn" in state &&
        state.neverlabsMediaLightboxReturn === true;
      if (isMediaLightboxReturnState) {
        const nextState = { ...state };
        delete nextState.neverlabsMediaLightboxReturn;
        window.history.replaceState(nextState, "", window.location.href);
      }
      if (
        isKeywordPickerHistoryState ||
        isMediaLightboxState ||
        isMediaLightboxReturnState
      ) {
        return;
      }

      const currentRoute = routeRef.current;
      const pathLanguage = getLanguageFromPathname(window.location.pathname);
      const nextLanguage = pathLanguage ?? currentRoute.language;
      let nextPage = getPageFromPathname(window.location.pathname);
      let nextProjectName = getProjectNameFromPathname(
        window.location.pathname,
      );

      if (currentRoute.page === "project-detail") {
        nextPage = "projects";
        nextProjectName = null;
      } else if (currentRoute.page !== "home") {
        nextPage = "home";
        nextProjectName = null;
      }

      const canonicalPath = getLocalizedPath(
        nextLanguage,
        nextPage,
        nextProjectName,
      );
      if (window.location.pathname !== canonicalPath) {
        window.history.replaceState(
          { neverlabsRoute: nextPage },
          "",
          `${canonicalPath}${window.location.search}${window.location.hash}`,
        );
      }

      routeRef.current = {
        language: nextLanguage,
        page: nextPage,
        projectName: nextProjectName,
      };
      flushSync(() => {
        setLanguage(nextLanguage);
        setCurrentPage(nextPage);
        setProjectName(nextProjectName);
        setIsHeaderVisible(true);
      });

      if (currentRoute.page !== "project-detail" && nextPage === "home") {
        window.scrollTo(0, 0);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    let previousScrollY = window.scrollY;

    const handleScroll = () => {
      const currentScrollY = window.scrollY;

      if (currentScrollY <= 8) {
        setIsHeaderVisible(true);
      } else if (currentScrollY < previousScrollY) {
        setIsHeaderVisible(true);
      } else if (currentScrollY > previousScrollY) {
        setIsHeaderVisible(false);
      }

      previousScrollY = currentScrollY;
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const beginNavigation = (
    nextLanguage: Language,
    nextPage: Page,
    nextProjectName: string | null = null,
  ) => {
    if (
      nextLanguage === language &&
      nextPage === currentPage &&
      nextProjectName === projectName
    ) {
      setIsHeaderVisible(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const updatePage = () => {
      const path = `${getLocalizedPath(
        nextLanguage,
        nextPage,
        nextProjectName,
      )}${window.location.search}`;
      window.history.pushState({ neverlabsRoute: nextPage }, "", path);
      routeRef.current = {
        language: nextLanguage,
        page: nextPage,
        projectName: nextProjectName,
      };

      flushSync(() => {
        setLanguage(nextLanguage);
        setCurrentPage(nextPage);
        setProjectName(nextProjectName);
        setIsHeaderVisible(true);
      });

      window.scrollTo(0, 0);
    };

    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      typeof document.startViewTransition !== "function"
    ) {
      updatePage();
      return;
    }

    const availableDirections = slideDirections
      .map((_, index) => index)
      .filter((index) => index !== lastSlideDirection.current);
    const directionIndex =
      availableDirections[Math.floor(Math.random() * availableDirections.length)];
    const direction = slideDirections[directionIndex];
    lastSlideDirection.current = directionIndex;

    document.documentElement.style.setProperty("--page-slide-x", direction.x);
    document.documentElement.style.setProperty("--page-slide-y", direction.y);
    document.documentElement.style.setProperty(
      "--page-slide-rotate-x",
      direction.rotateX,
    );
    document.documentElement.style.setProperty(
      "--page-slide-rotate-y",
      direction.rotateY,
    );
    document.documentElement.style.setProperty(
      "--page-slide-origin",
      direction.origin,
    );
    document.documentElement.style.setProperty(
      "--page-slide-shadow",
      direction.shadow,
    );

    document.startViewTransition(updatePage);
  };

  const handleNavigationClick: PageNavigationHandler = (
    event: MouseEvent<HTMLAnchorElement>,
    page: Page,
    nextProjectName,
  ) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    beginNavigation(language, page, nextProjectName ?? null);
  };

  const homeUrl = getLocalizedPath(language, "home");
  const aboutUrl = getLocalizedPath(language, "about");
  const projectsUrl = getLocalizedPath(language, "projects");
  const blogUrl = getLocalizedPath(language, "blog");
  const pageClassName = [
    "page",
    isChinese && "page-zh",
    currentPage === "projects" && "page-projects",
    currentPage === "about" && "page-about",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main
      className={pageClassName}
      lang={isChinese ? "zh-CN" : "en"}
    >
      <header
        className={isHeaderVisible ? "topbar" : "topbar topbar-hidden"}
        aria-hidden={!isHeaderVisible}
      >
        <Brand href={homeUrl} />
        <nav className="main-nav" aria-label={isChinese ? "主导航" : "Main navigation"}>
          <a
            href={homeUrl}
            aria-current={currentPage === "home" ? "page" : undefined}
            onClick={(event) => handleNavigationClick(event, "home")}
          >
            {text.home}
          </a>
          <a
            href={aboutUrl}
            aria-current={currentPage === "about" ? "page" : undefined}
            onClick={(event) => handleNavigationClick(event, "about")}
          >
            {text.about}
          </a>
          <a
            href={projectsUrl}
            aria-current={
              currentPage === "projects" || currentPage === "project-detail"
                ? "page"
                : undefined
            }
            onClick={(event) => handleNavigationClick(event, "projects")}
          >
            {text.projects}
          </a>
          <a
            href={blogUrl}
            aria-current={currentPage === "blog" ? "page" : undefined}
            onClick={(event) => handleNavigationClick(event, "blog")}
          >
            {text.blog}
          </a>
        </nav>
        <div className="topbar-actions">
          <a className="get-app" href={emailAddress}>
            {text.getInTouch}
            <ArrowUpRight size={17} strokeWidth={1.7} />
          </a>
          <div className="language-switch" role="group" aria-label="Language">
            <button
              className={isChinese ? "language-option active" : "language-option"}
              type="button"
              onClick={() => beginNavigation("zh", currentPage, projectName)}
              aria-pressed={isChinese}
            >
              中文
            </button>
            <button
              className={!isChinese ? "language-option active" : "language-option"}
              type="button"
              onClick={() => beginNavigation("en", currentPage, projectName)}
              aria-pressed={!isChinese}
            >
              EN
            </button>
          </div>
        </div>
      </header>

      <PageSections
        language={language}
        page={currentPage}
        onNavigate={handleNavigationClick}
        project={selectedProject}
        projects={projects}
        projectsLoading={projectsLoading}
        projectsError={projectsError}
        onProjectNavigate={(name) =>
          beginNavigation(language, "project-detail", name)
        }
        onProjectsBack={() => beginNavigation(language, "projects")}
      />

      <div className="section-rule home-footer-rule" />
      <footer className="site-footer">
        <div className="footer-grid">
          <section className="footer-brand" id="about" aria-label="Neverlabs">
            <Brand href={homeUrl} />
            <div className="brand-description">
              {text.brandDescription.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
            <nav className="social-links" aria-label={isChinese ? "联系方式" : "Contact links"}>
              {contacts.map(({ label, href, Icon }) => (
                <a
                  href={href}
                  key={label}
                  aria-label={label}
                  title={label}
                  target={href.startsWith("https://") ? "_blank" : undefined}
                  rel={href.startsWith("https://") ? "noreferrer" : undefined}
                >
                  <Icon size={20} strokeWidth={1.8} />
                </a>
              ))}
            </nav>
          </section>

          <nav className="footer-column changelog-column" aria-label={text.projectHeading}>
            <h2>{text.projectHeading}</h2>
            {text.projectItems.map((item) => (
              <span className="footer-link" key={item}>
                {item}
              </span>
            ))}
          </nav>

          <nav className="footer-column legal-column" aria-label={text.connect}>
            <h2>{text.connect}</h2>
            {contacts.slice(0, 3).map(({ label, href }) => (
              <a
                className="footer-link"
                href={href}
                key={label}
                target={href.startsWith("https://") ? "_blank" : undefined}
                rel={href.startsWith("https://") ? "noreferrer" : undefined}
              >
                {label}
              </a>
            ))}
          </nav>
        </div>

        <div className="footer-bottom">
          <span>© 2026 Neverlabs. All rights reserved.</span>
          <a href={privacyHref}>Privacy</a>
          <a href={termsHref}>Terms</a>
        </div>
      </footer>
    </main>
  );
}

export default function App() {
  return /^\/admin\/?$/.test(window.location.pathname)
    ? <AdminPage />
    : <PortfolioApp />;
}
