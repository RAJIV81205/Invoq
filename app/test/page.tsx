"use client";

import { useState, useCallback } from "react";
import { runAllTests } from "./test";
import { connectFreighter, getFreighterAddress } from "@/lib/freighter";
import type { TestResult } from "@/lib/types";

const SECTIONS = [
  "Health & Auth",
  "Plans (Fee Bump)",
  "Checkout",
  "Entitlement",
  "Usage",
  "Subscriptions",
  "Vault",
  "Webhooks",
  "Dashboard APIs",
];

export default function TestPage() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<Map<number, TestResult[]>>(new Map());
  const [currentSection, setCurrentSection] = useState<number | null>(null);

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      await connectFreighter();
      const address = await getFreighterAddress();
      setWalletAddress(address);
    } catch (error: any) {
      alert(`Failed to connect: ${error.message}`);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleRunTests = useCallback(async () => {
    if (!walletAddress) {
      alert("Please connect your wallet first");
      return;
    }

    setIsRunning(true);
    setResults(new Map());
    setCurrentSection(null);

    const report = (section: number, result: TestResult) => {
      setCurrentSection(section);
      setResults((prev) => {
        const newMap = new Map(prev);
        const sectionResults = newMap.get(section) || [];
        newMap.set(section, [...sectionResults, result]);
        return newMap;
      });
    };

    try {
      await runAllTests(walletAddress, report);
    } catch (error: any) {
      alert(`Test suite error: ${error.message}`);
    } finally {
      setIsRunning(false);
      setCurrentSection(null);
    }
  }, [walletAddress]);

  const getStatusIcon = (status: TestResult["status"]) => {
    switch (status) {
      case "pass":
        return "✓";
      case "fail":
        return "✗";
      case "skip":
        return "○";
    }
  };

  const getStatusColor = (status: TestResult["status"]) => {
    switch (status) {
      case "pass":
        return "text-green-600";
      case "fail":
        return "text-red-600";
      case "skip":
        return "text-gray-400";
    }
  };

  const getSectionStats = (sectionIdx: number) => {
    const sectionResults = results.get(sectionIdx) || [];
    const pass = sectionResults.filter((r) => r.status === "pass").length;
    const fail = sectionResults.filter((r) => r.status === "fail").length;
    const skip = sectionResults.filter((r) => r.status === "skip").length;
    return { pass, fail, skip, total: sectionResults.length };
  };

  const totalStats = Array.from(results.values())
    .flat()
    .reduce(
      (acc, r) => {
        acc[r.status]++;
        acc.total++;
        return acc;
      },
      { pass: 0, fail: 0, skip: 0, total: 0 }
    );

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            Invoq API Test Suite
          </h1>

          <div className="flex items-center gap-4">
            {!walletAddress ? (
              <button
                onClick={handleConnect}
                disabled={isConnecting}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {isConnecting ? "Connecting..." : "Connect Freighter Wallet"}
              </button>
            ) : (
              <div className="flex items-center gap-4 flex-1">
                <div className="flex-1">
                  <div className="text-sm text-gray-600">Connected Wallet</div>
                  <div className="font-mono text-sm text-gray-900 truncate">
                    {walletAddress}
                  </div>
                </div>
                <button
                  onClick={handleRunTests}
                  disabled={isRunning}
                  className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {isRunning ? "Running Tests..." : "Run All Tests"}
                </button>
              </div>
            )}
          </div>

          {/* Overall Stats */}
          {totalStats.total > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="flex gap-6 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-gray-600">Total:</span>
                  <span className="font-semibold">{totalStats.total}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-green-600">✓ Pass:</span>
                  <span className="font-semibold">{totalStats.pass}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-red-600">✗ Fail:</span>
                  <span className="font-semibold">{totalStats.fail}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">○ Skip:</span>
                  <span className="font-semibold">{totalStats.skip}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Test Sections */}
        <div className="space-y-4">
          {SECTIONS.map((sectionName, idx) => {
            const sectionResults = results.get(idx) || [];
            const stats = getSectionStats(idx);
            const isActive = currentSection === idx;

            return (
              <div
                key={idx}
                className={`bg-white rounded-lg shadow-sm overflow-hidden transition-all ${
                  isActive ? "ring-2 ring-blue-500" : ""
                }`}
              >
                {/* Section Header */}
                <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-gray-900">
                      {idx}. {sectionName}
                    </h2>
                    {stats.total > 0 && (
                      <div className="flex gap-4 text-sm">
                        <span className="text-green-600">✓ {stats.pass}</span>
                        <span className="text-red-600">✗ {stats.fail}</span>
                        <span className="text-gray-400">○ {stats.skip}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Section Results */}
                {sectionResults.length > 0 && (
                  <div className="divide-y divide-gray-100">
                    {sectionResults.map((result, resultIdx) => (
                      <div
                        key={resultIdx}
                        className="px-6 py-3 hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={`text-xl font-bold ${getStatusColor(
                              result.status
                            )}`}
                          >
                            {getStatusIcon(result.status)}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900">
                              {result.label}
                            </div>
                            {result.detail && (
                              <div className="text-sm text-gray-600 mt-1">
                                {result.detail}
                              </div>
                            )}
                            <div className="flex gap-4 mt-1">
                              {result.txHash && (
                                <a
                                  href={`https://stellar.expert/explorer/testnet/tx/${result.txHash}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-blue-600 hover:underline font-mono"
                                >
                                  {result.txHash.slice(0, 8)}...
                                  {result.txHash.slice(-8)}
                                </a>
                              )}
                              {result.ms !== undefined && (
                                <span className="text-xs text-gray-500">
                                  {result.ms}ms
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Empty State */}
                {sectionResults.length === 0 && !isRunning && (
                  <div className="px-6 py-8 text-center text-gray-400">
                    No tests run yet
                  </div>
                )}

                {/* Loading State */}
                {isActive && isRunning && (
                  <div className="px-6 py-4 bg-blue-50">
                    <div className="flex items-center gap-3">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                      <span className="text-sm text-blue-600">
                        Running tests...
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>
            Make sure your Freighter wallet is connected to Stellar Testnet and
            has sufficient XLM balance.
          </p>
        </div>
      </div>
    </div>
  );
}