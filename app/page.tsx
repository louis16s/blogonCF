import { BlogExplorer } from "./components/BlogExplorer";
import { fallbackPosts } from "./data/fallback-posts";

export default function Home() {
  return <BlogExplorer initialPosts={fallbackPosts} />;
}
