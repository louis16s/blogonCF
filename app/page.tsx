import { BlogExplorer } from "./components/BlogExplorer";
import { IntroSequence } from "./components/IntroSequence";
import { INTRO_BOOTSTRAP_SCRIPT } from "./components/introState";
import { headers } from "next/headers";
import { readHomePayload } from "../server/home-context";

export default async function Home() {
  const key = (await headers()).get("x-blog-home-context");
  const payload = readHomePayload(key);
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: INTRO_BOOTSTRAP_SCRIPT }} />
      <IntroSequence enabled={payload?.config.introEnabled} title={payload?.config.introTitle} subtitle={payload?.config.introSubtitle} />
      <BlogExplorer initialPosts={payload?.posts} initialLinks={payload?.links} initialConfig={payload?.config} />
    </>
  );
}
