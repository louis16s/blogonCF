import { BlogExplorer } from "./components/BlogExplorer";
import { headers } from "next/headers";
import { readHomePayload } from "../server/home-context";

export default async function Home() {
  const key = (await headers()).get("x-blog-home-context");
  const payload = readHomePayload(key);
  return <BlogExplorer initialPosts={payload?.posts} initialLinks={payload?.links} initialConfig={payload?.config} />;
}
