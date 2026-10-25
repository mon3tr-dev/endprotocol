import React from "react";
import {
  Home,
  BarChart3,
  Users,
  Star,
  Heart,
  Bookmark,
  Tag,
  Folder,
  Calendar,
  Bell,
  Settings,
  User,
  Search,
  Code,
  FolderOpen,
  Plus,
  ChevronLeft,
  Pencil,
  Trash2,
  Award,
  Sparkles,
  HelpCircle,
  Monitor,
  Moon,
  Sun,
  FileText,
  Map,
  Satellite,
  CircleHelp,
  Factory,
  Sprout,
  Terminal,
  Copy,
  ExternalLink,
  Gamepad2,
} from "lucide";
import { MorphIcon } from "morphicons/react";
import { createMorphIcon, type IconSvgProps } from "@/components/morph-icon";
import type { IconInput } from "morphicons";

export const Logo: React.FC<IconSvgProps> = ({
  size = 36,
  height,
  ...props
}) => (
  <svg
    fill="none"
    height={size || height}
    viewBox="0 0 32 32"
    width={size || height}
    {...props}
  >
    <path
      clipRule="evenodd"
      d="M17.6482 10.1305L15.8785 7.02583L7.02979 22.5499H10.5278L17.6482 10.1305ZM19.8798 14.0457L18.11 17.1983L19.394 19.4511H16.8453L15.1056 22.5499H24.7272L19.8798 14.0457Z"
      fill="currentColor"
      fillRule="evenodd"
    />
  </svg>
);

export const DiscordIcon = createMorphIcon([
  ["path", { d: "M14.82 4.26a10.14 10.14 0 0 0-.53 1.1 14.66 14.66 0 0 0-4.58 0 10.14 10.14 0 0 0-.53-1.1 16 16 0 0 0-4.13 1.3 17.33 17.33 0 0 0-3 11.59 16.6 16.6 0 0 0 5.07 2.59A12.89 12.89 0 0 0 8.23 18a9.65 9.65 0 0 1-1.71-.83 3.39 3.39 0 0 0 .42-.33 11.66 11.66 0 0 0 10.12 0q.21.18.42.33a10.84 10.84 0 0 1-1.71.84 12.41 12.41 0 0 0 1.08 1.78 16.44 16.44 0 0 0 5.06-2.59 17.22 17.22 0 0 0-3-11.59 16.09 16.09 0 0 0-4.09-1.35zM8.68 14.81a1.94 1.94 0 0 1-1.8-2 1.93 1.93 0 0 1 1.8-2 1.93 1.93 0 0 1 1.8 2 1.93 1.93 0 0 1-1.8 2zm6.64 0a1.94 1.94 0 0 1-1.8-2 1.93 1.93 0 0 1 1.8-2 1.92 1.92 0 0 1 1.8 2 1.92 1.92 0 0 1-1.8 2z", fill: "currentColor" }],
]);

export const TwitterIcon = createMorphIcon([
  ["path", { d: "M19.633 7.997c.013.175.013.349.013.523 0 5.325-4.053 11.461-11.46 11.461-2.282 0-4.402-.661-6.186-1.809.324.037.636.05.973.05a8.07 8.07 0 0 0 5.001-1.721 4.036 4.036 0 0 1-3.767-2.793c.249.037.499.062.761.062.361 0 .724-.05 1.061-.137a4.027 4.027 0 0 1-3.23-3.953v-.05c.537.299 1.16.486 1.82.511a4.022 4.022 0 0 1-1.796-3.354c0-.748.199-1.434.548-2.032a11.457 11.457 0 0 0 8.306 4.215c-.062-.3-.1-.611-.1-.923a4.026 4.026 0 0 1 4.028-4.028c1.16 0 2.207.486 2.943 1.272a7.957 7.957 0 0 0 2.556-.973 4.02 4.02 0 0 1-1.771 2.22 8.073 8.073 0 0 0 2.319-.624 8.645 8.645 0 0 1-2.019 2.083z", fill: "currentColor" }],
]);

export const GithubIcon = createMorphIcon([
  ["path", { clipRule: "evenodd", d: "M12.026 2c-5.509 0-9.974 4.465-9.974 9.974 0 4.406 2.857 8.145 6.821 9.465.499.09.679-.217.679-.481 0-.237-.008-.865-.011-1.696-2.775.602-3.361-1.338-3.361-1.338-.452-1.152-1.107-1.459-1.107-1.459-.905-.619.069-.605.069-.605 1.002.07 1.527 1.028 1.527 1.028.89 1.524 2.336 1.084 2.902.829.091-.645.351-1.085.635-1.334-2.214-.251-4.542-1.107-4.542-4.93 0-1.087.389-1.979 1.024-2.675-.101-.253-.446-1.268.099-2.64 0 0 .837-.269 2.742 1.021a9.582 9.582 0 0 1 2.496-.336 9.554 9.554 0 0 1 2.496.336c1.906-1.291 2.742-1.021 2.742-1.021.545 1.372.203 2.387.099 2.64.64.696 1.024 1.587 1.024 2.675 0 3.833-2.33 4.675-4.552 4.922.355.308.675.916.675 1.846 0 1.334-.012 2.41-.012 2.737 0 .267.178.577.687.479C19.146 20.115 22 16.379 22 11.974 22 6.465 17.535 2 12.026 2z", fill: "currentColor", fillRule: "evenodd" }],
]);

export const MoonIcon = createMorphIcon(Moon);
export const SunIcon = createMorphIcon(Sun);
export const ComputerIcon = createMorphIcon(Monitor);
export const HeartIcon = createMorphIcon(Heart);
export const SearchIcon = createMorphIcon(Search);
export const HomeIcon = createMorphIcon(Home);
export const ChartIcon = createMorphIcon(BarChart3);
export const SettingsIcon = createMorphIcon(Settings);
export const UsersIcon = createMorphIcon(Users);
export const ProjectsIcon = createMorphIcon(FolderOpen);
export const CalendarIcon = createMorphIcon(Calendar);
export const HelpIcon = createMorphIcon(HelpCircle);
export const DeveloperIcon = createMorphIcon(Code);
export const AccountIcon = createMorphIcon(User);
export const StarIcon = createMorphIcon(Star);
export const GachaIcon = createMorphIcon(Sparkles);
export const MedalIcon = createMorphIcon(Award);
export const BookmarkIcon = createMorphIcon(Bookmark);
export const TagIcon = createMorphIcon(Tag);
export const FolderIcon = createMorphIcon(Folder);
export const BellIcon = createMorphIcon(Bell);
export const PlusIcon = createMorphIcon(Plus);
export const ChevronLeftIcon = createMorphIcon(ChevronLeft);
export const EditIcon = createMorphIcon(Pencil);
export const TrashIcon = createMorphIcon(Trash2);
export const TerminalIcon = createMorphIcon(Terminal);
export const CopyIcon = createMorphIcon(Copy);
export const ExternalLinkIcon = createMorphIcon(ExternalLink);
export const GamepadIcon = createMorphIcon(Gamepad2);
export const MapIcon = createMorphIcon(Map);
export const SatelliteIcon = createMorphIcon(Satellite);

export { MoonIcon as MoonFilledIcon, SunIcon as SunFilledIcon, HeartIcon as HeartFilledIcon };

const CARD_ICON_MAP: Record<string, IconInput> = {
  home: Home,
  chart: BarChart3,
  users: Users,
  star: Star,
  heart: Heart,
  bookmark: Bookmark,
  tag: Tag,
  folder: Folder,
  calendar: Calendar,
  bell: Bell,
  settings: Settings,
  account: User,
  search: Search,
  developer: Code,
  projects: FolderOpen,
  file: FileText,
  map: Map,
  satellite: Satellite,
  award: Award,
  user: User,
  help: CircleHelp,
  factory: Factory,
  sprout: Sprout,
};

export function CardIcon({
  iconKey,
  size = 24,
  className,
  ...rest
}: IconSvgProps & { iconKey: string }) {
  const data = CARD_ICON_MAP[iconKey];
  if (!data) return <span className={className}>{iconKey}</span>;
  const { from: _from, to: _to, ref: _ref, ...svgRest } = rest as any;
  return <MorphIcon icon={data} size={size} className={className} {...svgRest} />;
}
