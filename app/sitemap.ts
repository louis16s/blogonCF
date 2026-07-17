import type { MetadataRoute } from "next";
import { fallbackPosts } from "./data/fallback-posts";
export default function sitemap(): MetadataRoute.Sitemap { return [{ url: "/", changeFrequency: "weekly", priority: 1 }, ...fallbackPosts.map((post) => ({ url: `/blog/${encodeURIComponent(post.slug)}`, lastModified: post.date, changeFrequency: "monthly" as const, priority: 0.7 }))]; }
