import { describe, expect, test } from "vitest";

import {
  looksLikeId,
  parseRef,
  resolveDataset,
  resolveModel,
  resolveProject,
} from "../src/resolve.js";

describe("looksLikeId / parseRef", () => {
  test("looksLikeId", () => {
    expect(looksLikeId("6a15700a49a694644aeb62aa")).toBe(true);
    expect(looksLikeId("6A15700A49A694644AEB62AA")).toBe(true);
    expect(looksLikeId("road-safety-101")).toBe(false);
    expect(looksLikeId("user/project")).toBe(false);
  });

  test("parseRef", () => {
    expect(parseRef("project")).toEqual({ isUlUri: false, parts: ["project"] });
    expect(parseRef("user/project")).toEqual({
      isUlUri: false,
      parts: ["user", "project"],
    });
    expect(parseRef("ul://user/datasets/data")).toEqual({
      isUlUri: true,
      parts: ["user", "datasets", "data"],
    });
    expect(parseRef("ul://user/project/model")).toEqual({
      isUlUri: true,
      parts: ["user", "project", "model"],
    });
  });
});

describe("resolveProject", () => {
  test("parses owner/slug into a pair with no network call", () => {
    expect(resolveProject("u/p")).toEqual({ owner: "u", project: "p" });
  });

  test("parses a ul:// project URI into a pair with no network call", () => {
    expect(resolveProject("ul://u/p")).toEqual({ owner: "u", project: "p" });
  });

  test("parses a bare slug with a null owner and no network call", () => {
    expect(resolveProject("p")).toEqual({ owner: null, project: "p" });
  });

  test("trims surrounding whitespace", () => {
    expect(resolveProject("  u/p  ")).toEqual({ owner: "u", project: "p" });
  });

  test("rejects a bare 24-hex id and names the accepted ref forms", () => {
    expect(() => resolveProject("6a15700a49a694644aeb62aa")).toThrow(
      /not addressable.*slug.*owner\/slug.*ul:\/\//s,
    );
  });

  test("rejects an uppercase 24-hex id", () => {
    expect(() => resolveProject("6A15700A49A694644AEB62AA")).toThrow(
      /not addressable/,
    );
  });

  test("rejects a blank reference", () => {
    expect(() => resolveProject("   ")).toThrow(/Cannot parse project/);
  });

  test("rejects a slash-only reference", () => {
    expect(() => resolveProject("///")).toThrow(/Cannot parse project/);
  });

  test("rejects a three-segment reference", () => {
    expect(() => resolveProject("a/b/c")).toThrow(/Cannot parse project/);
  });

  test("a dataset URI is rejected and points at the project form", () => {
    expect(() => resolveProject("ul://u/datasets/data")).toThrow(
      /dataset URI, not a project.*ul:\/\/owner\/project/s,
    );
  });

  test("a model URI is rejected and points at the project form", () => {
    expect(() => resolveProject("ul://u/p/m")).toThrow(
      /model URI.*ul:\/\/u\/p/s,
    );
  });

  test("a malformed project ul:// URI names the expected form", () => {
    expect(() => resolveProject("ul://only-one-part")).toThrow(
      /Unsupported project ul:\/\/ URI.*ul:\/\/owner\/project/s,
    );
  });
});

describe("resolveDataset", () => {
  test("parses owner/slug into a pair with no network call", () => {
    expect(resolveDataset("u/data")).toEqual({ owner: "u", dataset: "data" });
  });

  test("parses a ul:// dataset URI into a pair with no network call", () => {
    expect(resolveDataset("ul://u/data")).toEqual({
      owner: "u",
      dataset: "data",
    });
  });

  test("parses the canonical ul://owner/datasets/slug URI into a pair", () => {
    expect(resolveDataset("ul://u/datasets/data")).toEqual({
      owner: "u",
      dataset: "data",
    });
  });

  test("parses a bare slug with a null owner and no network call", () => {
    expect(resolveDataset("data")).toEqual({ owner: null, dataset: "data" });
  });

  test("trims surrounding whitespace", () => {
    expect(resolveDataset("  u/data  ")).toEqual({
      owner: "u",
      dataset: "data",
    });
  });

  test("rejects a bare 24-hex id and names the accepted ref forms", () => {
    expect(() => resolveDataset("6a15700a49a694644aeb62aa")).toThrow(
      /not addressable.*slug.*owner\/slug.*ul:\/\//s,
    );
  });

  test("rejects an uppercase 24-hex id", () => {
    expect(() => resolveDataset("6A15700A49A694644AEB62AA")).toThrow(
      /not addressable/,
    );
  });

  test("rejects a blank reference", () => {
    expect(() => resolveDataset("   ")).toThrow(/Cannot parse dataset/);
  });

  test("rejects a slash-only reference", () => {
    expect(() => resolveDataset("///")).toThrow(/Cannot parse dataset/);
  });

  test("rejects a three-segment reference", () => {
    expect(() => resolveDataset("a/b/c")).toThrow(/Cannot parse dataset/);
  });

  test("a model URI is rejected and points at the dataset form", () => {
    expect(() => resolveDataset("ul://u/proj/mod")).toThrow(
      /model URI.*ul:\/\/owner\/dataset/s,
    );
  });

  test("a malformed dataset ul:// URI names the canonical form first", () => {
    expect(() => resolveDataset("ul://only-one-part")).toThrow(
      /Unsupported dataset ul:\/\/ URI.*ul:\/\/owner\/datasets\/slug.*ul:\/\/owner\/dataset'/s,
    );
  });

  test("a near-miss on the canonical URI names the canonical form", () => {
    expect(() => resolveDataset("ul://u/datasets/data/extra")).toThrow(
      /Unsupported dataset ul:\/\/ URI.*ul:\/\/owner\/datasets\/slug/s,
    );
  });
});

describe("resolveModel", () => {
  test("parses owner/project/model into a triple with no network call", () => {
    expect(resolveModel("u/proj/mod")).toEqual({
      owner: "u",
      project: "proj",
      model: "mod",
    });
  });

  test("parses a ul:// model URI into a triple with no network call", () => {
    expect(resolveModel("ul://u/proj/mod")).toEqual({
      owner: "u",
      project: "proj",
      model: "mod",
    });
  });

  test("parses a bare slug with an owner/slug project without network", () => {
    expect(resolveModel("mod", "u/proj")).toEqual({
      owner: "u",
      project: "proj",
      model: "mod",
    });
  });

  test("parses a bare slug with a ul:// project without network", () => {
    expect(resolveModel("mod", "ul://u/proj")).toEqual({
      owner: "u",
      project: "proj",
      model: "mod",
    });
  });

  test("leaves a missing owner as null for the caller to fill", () => {
    expect(resolveModel("mod", "proj")).toEqual({
      owner: null,
      project: "proj",
      model: "mod",
    });
  });

  test("trims surrounding whitespace", () => {
    expect(resolveModel("  u/proj/mod  ")).toEqual({
      owner: "u",
      project: "proj",
      model: "mod",
    });
  });

  test("rejects a bare 24-hex id and names the accepted ref forms", () => {
    expect(() => resolveModel("6a15700a49a694644aeb62aa")).toThrow(
      /not addressable.*owner\/project\/model.*ul:\/\//s,
    );
  });

  test("rejects an uppercase 24-hex id", () => {
    expect(() => resolveModel("6A15700A49A694644AEB62AA")).toThrow(
      /not addressable/,
    );
  });

  test("rejects a blank reference", () => {
    expect(() => resolveModel("   ")).toThrow(/Cannot parse model/);
  });

  test("rejects a slash-only reference", () => {
    expect(() => resolveModel("///")).toThrow(/Cannot parse model/);
  });

  test("rejects a two-segment path reference", () => {
    expect(() => resolveModel("a/b", "u/proj")).toThrow(/Cannot parse model/);
  });

  test("a dataset URI is rejected and points at the model form", () => {
    expect(() => resolveModel("ul://u/datasets/data")).toThrow(
      /dataset URI, not a model.*owner\/project\/model/s,
    );
  });

  test("a project URI is rejected and points at the model form", () => {
    expect(() => resolveModel("ul://u/proj")).toThrow(
      /project URI, not a model.*owner\/project\/model/s,
    );
  });

  test("a malformed model ul:// URI names the expected form", () => {
    expect(() => resolveModel("ul://only-one-part")).toThrow(
      /Unsupported model ul:\/\/ URI.*ul:\/\/owner\/project\/model/s,
    );
  });

  test("a bare slug without a project fails loudly", () => {
    expect(() => resolveModel("mod")).toThrow(
      /slug; a project is required.*owner\/project\/model/s,
    );
  });

  test("a dataset URI as the project ref stays a dataset error", () => {
    expect(() => resolveModel("mod", "ul://u/datasets/data")).toThrow(
      /dataset URI, not a project/,
    );
  });
});
