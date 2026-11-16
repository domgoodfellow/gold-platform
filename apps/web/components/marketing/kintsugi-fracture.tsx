import { useId } from 'react';

type FractureVariant = 'hero' | 'bridge' | 'products' | 'automation' | 'connected' | 'process' | 'trust' | 'cta' | 'footer';

// Every composition meets at (970, 0/600). Section height may change with authored
// content; non-scaling strokes keep the metal fine while the junctions stay joined.
const GEOMETRY: Record<FractureVariant, { main: string; branches: string; fine: string }> = {
  hero: {
    main: 'M970 -30 961 21 921 65 Q913 75 921 90 L938 128 891 170 Q862 193 864 201 L888 264 828 314 Q801 335 807 337 L835 393 911 429 Q945 444 941 448 L918 507 948 559 970 600',
    branches: 'M864 201 948 193 Q991 189 1004 179 L1031 112 1100 85 M888 264 957 289 Q998 302 1015 311 L1055 398 1120 420 M835 393 798 438 Q780 457 760 472 L724 505 710 541 Q704 550 683 556 L608 566 Q557 580 503 577 L347 573 205 559 118 568 -80 516 M938 128 894 110 Q870 98 862 77 L847 37 779 -30',
    fine: 'M1015 311 1057 285 1081 238 M724 505 758 535 804 548 M921 65 989 42 1006 -20 M807 337 772 311 733 326 M941 448 1004 473 1036 526 M347 573 299 551 244 544 M118 568 64 594 -40 613',
  },
  bridge: {
    main: 'M970 0 951 91 983 153 943 230 964 298 921 371 955 468 970 600',
    branches: 'M943 230 1012 204 1070 238 M921 371 867 407 846 472 785 496',
    fine: 'M951 91 916 114 901 172 M955 468 1010 497 1041 557',
  },
  products: {
    main: 'M970 0 942 90 960 181 922 269 948 337 926 432 974 510 970 600',
    branches: 'M942 90 875 121 841 95 799 112 M922 269 1002 239 1043 279 M926 432 860 487 815 474 762 525',
    fine: 'M875 121 860 172 814 206 M948 337 998 362 1021 413',
  },
  automation: {
    main: 'M970 0 981 79 938 163 958 247 921 334 956 423 941 501 970 600',
    branches: 'M938 163 878 198 856 259 785 281 M956 423 1024 448 1059 501',
    fine: 'M878 198 820 176 788 190 M921 334 987 310 1017 263',
  },
  connected: {
    main: 'M970 0 946 97 963 194 932 277 959 356 924 449 950 524 970 600',
    branches: 'M963 194 1019 164 1061 187 M924 449 869 469 828 433 772 451',
    fine: 'M946 97 894 130 877 193 M869 469 852 529 803 557',
  },
  process: {
    main: 'M970 0 941 102 959 184 934 271 953 369 932 460 970 600',
    branches: 'M941 102 879 77 841 105 789 89 M953 369 1013 344 1078 377',
    fine: 'M934 271 896 300 875 355 M932 460 890 502 904 549',
  },
  trust: {
    main: 'M970 0 946 95 966 180 934 282 957 373 936 481 970 600',
    branches: 'M966 180 1024 151 1082 181 M936 481 876 454 839 482 789 470',
    fine: 'M946 95 907 134 899 193 M957 373 1001 402 1024 461',
  },
  cta: {
    main: 'M970 0 940 92 964 161 904 257 929 340 865 413 914 485 970 600',
    branches: 'M904 257 1004 222 1041 145 1110 128 M865 413 811 458 755 440 700 478',
    fine: 'M929 340 1008 379 1028 445 M811 458 796 519 824 556 M940 92 894 60 870 -20',
  },
  footer: {
    main: 'M970 0 933 95 959 193 918 278 948 372 928 466 970 600',
    branches: 'M933 95 868 131 829 112 782 142 M948 372 1018 343 1070 386',
    fine: 'M918 278 882 304 868 362 M928 466 873 507 842 498',
  },
};

// Occasional cross-page repairs live in the whitespace, rather than outlining cards.
const CROSSINGS: Partial<Record<FractureVariant, string>> = {
  products: 'M972.6 510 981 541 962 566 917 572 835 565 Q772 573 697 566 L581 576 475 562 Q439 557 411 566 L332 577 209 561 119 574 -80 541',
  connected: 'M957 524 981 547 952 568 864 578 749 559 Q697 552 643 565 L528 579 421 564 327 573 Q263 580 209 563 L108 549 -80 572',
  trust: 'M947.9 481 979 548 953 568 875 580 791 569 Q739 578 677 566 L571 578 462 558 Q413 552 371 565 L252 579 159 557 61 571 -80 546',
};

/** Marketing-owned, fixed artwork. Only a masked reflection moves; no client runtime. */
export function KintsugiFracture({ variant }: { variant: FractureVariant }) {
  const id = `kintsugi-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const geometry = GEOMETRY[variant];
  // Compress the quieter repairs into the gutter, keeping x=970 fixed.
  const gutter = variant === 'hero' ? undefined : 'translate(339.5 0) scale(.65 1)';
  const junctions = variant === 'hero'
    ? 'M864 196 C875 195 889 195 905 193 C884 199 876 203 879 214 L889 240 C879 222 872 209 861 205Z M832 386 C839 397 849 400 868 410 C846 402 836 403 825 415 L804 437 C817 418 825 401 832 386Z'
    : undefined;
  const paths: { d: string; width: number; mobile?: boolean; crossing?: boolean }[] = [
    { d: geometry.main, width: variant === 'hero' ? 6.5 : 3.4 },
    { d: geometry.branches, width: variant === 'hero' ? 3.8 : 1.6 },
    { d: geometry.fine, width: 0.65 },
  ];
  if (variant === 'hero') paths.push({
    d: 'M970 0 880 22 907 38 848 55 956 80 976 150 958 245 981 330 956 440 974 510 970 600 M907 38 995 26 1050 -10 M848 55 792 33 734 42 M956 80 1040 67 1090 93',
    width: 3.4, mobile: true,
  });
  if (CROSSINGS[variant]) paths.push({ d: CROSSINGS[variant], width: 2.6, crossing: true });
  return (
    <svg className="kintsugi-fracture" data-fracture={variant} viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2="0.7">
          <stop stopColor="var(--marketing-gold-shadow)" />
          <stop offset=".24" stopColor="var(--marketing-gold)" />
          <stop offset=".4" stopColor="var(--marketing-gold-reflection)" />
          <stop offset=".46" stopColor="var(--marketing-gold-shadow)" />
          <stop offset=".5" stopColor="var(--marketing-gold)" />
          <stop offset=".76" stopColor="var(--marketing-gold)" />
          <stop offset="1" stopColor="var(--marketing-gold-reflection)" />
        </linearGradient>
        <linearGradient id={`${id}-reflection`}>
          <stop stopColor="var(--marketing-gold-reflection)" stopOpacity="0" />
          <stop offset=".48" stopColor="var(--marketing-gold-reflection)" stopOpacity=".2" />
          <stop offset=".5" stopColor="var(--marketing-gold-reflection)" />
          <stop offset=".54" stopColor="var(--marketing-gold-reflection)" stopOpacity=".2" />
          <stop offset="1" stopColor="var(--marketing-gold-reflection)" stopOpacity="0" />
        </linearGradient>
        <mask id={`${id}-seam`} maskUnits="userSpaceOnUse" x="0" y="0" width="1120" height="600">
          {paths.map(({ d, width, mobile, crossing }, index) => <path key={index} className={mobile ? 'kintsugi-mobile' : crossing ? 'kintsugi-crossing' : 'kintsugi-desktop'} transform={crossing ? undefined : gutter} d={d} fill="none" stroke="white" strokeWidth={width + 0.6} vectorEffect="non-scaling-stroke" />)}
          {junctions ? <path className="kintsugi-desktop" d={junctions} fill="white" /> : null}
        </mask>
      </defs>
        {paths.map(({ d, width, mobile, crossing }, index) => (
          <g key={index} className={mobile ? 'kintsugi-mobile' : crossing ? 'kintsugi-crossing' : 'kintsugi-desktop'} transform={crossing ? undefined : gutter} fill="none" strokeLinejoin="round">
            <path d={d} stroke="var(--marketing-groove)" strokeWidth={width + 1.5} vectorEffect="non-scaling-stroke" />
            <path d={d} stroke={`url(#${id}-metal)`} strokeWidth={width} vectorEffect="non-scaling-stroke" />
            <path d={d} stroke="var(--marketing-gold-reflection)" strokeOpacity=".25" strokeWidth={width * 0.55} vectorEffect="non-scaling-stroke" />
            <path d={d} stroke="var(--marketing-gold-reflection)" strokeOpacity=".6" strokeWidth={width * 0.22} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
        {junctions ? <path className="kintsugi-desktop" d={junctions} fill={`url(#${id}-metal)`} /> : null}
        <g mask={`url(#${id}-seam)`}>
          <rect className="kintsugi-reflection" x="-160" y="0" width="160" height="600" fill={`url(#${id}-reflection)`} />
        </g>
    </svg>
  );
}
