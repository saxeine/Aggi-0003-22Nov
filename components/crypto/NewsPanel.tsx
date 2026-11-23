import React from 'react';
import { RssNewsFeed } from './RssNewsFeed';

export const NewsPanel: React.FC<{ symbol: string; name?: string }> = ({ symbol, name }) => (
  <RssNewsFeed kind="crypto" symbol={symbol} name={name} />
);
