import React from 'react';
import { RssNewsFeed } from './RssNewsFeed';

export const StockNewsPanel: React.FC<{ symbol: string; name: string }> = ({ symbol, name }) => (
  <RssNewsFeed kind="stock" symbol={symbol} name={name} />
);
