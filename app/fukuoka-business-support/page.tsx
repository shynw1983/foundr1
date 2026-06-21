import type { Metadata } from "next";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "福冈事业实务支援 | Foundr1",
  description: "面向在福冈落地或准备开展业务的客户，提供法人账户、公司手续、福冈本地资源对接、网站制作与业务工具制作支援。"
};

const packages = [
  {
    code: "A",
    name: "免费初回面谈",
    price: "免费",
    term: "60 分钟",
    summary: "先确认你的情况适合哪一种支援方式。",
    points: ["了解目前遇到的问题", "确认是否需要开户、手续、资源、网站或系统", "说明大致推进方式和费用范围"]
  },
  {
    code: "B",
    name: "法人账户与公司手续支援包",
    price: "198,000 日元",
    term: "1 个月",
    summary: "适合已经设立公司，但法人账户和基础手续还没有完全顺起来的客户。",
    points: ["法人银行开户资料整理", "事业说明资料准备", "银行面谈前准备", "税理士、社劳士、行政书士等沟通协调"]
  },
  {
    code: "C",
    name: "福冈本地资源对接包",
    price: "198,000 日元起",
    term: "1 个月",
    summary: "适合需要在福冈找人、找服务、找办事路径的客户。",
    points: ["店铺、办公室、住居等方向咨询", "装修、设备、POS、网络、保险、印刷等资源对接", "专业人士候选介绍", "预约、初步沟通与必要陪同"]
  },
  {
    code: "D",
    name: "网站制作包",
    price: "330,000 日元起",
    term: "按项目",
    summary: "适合需要公司官网、店铺官网、服务介绍页或中日双语网站的客户。",
    points: ["页面结构整理", "中文/日文基础文案整理", "手机端适配", "联系表单、地图、LINE、SNS 链接设置"]
  },
  {
    code: "E",
    name: "预约・订单・业务工具制作包",
    price: "330,000 日元起",
    term: "按项目",
    summary: "适合想把预约、询价、订单、客户管理等工作变得更顺的客户。",
    points: ["预约或询价表单", "订单/客户管理工具", "自动回复与通知", "AI 文案、回复模板或小型内部管理工具"]
  }
];

const examples = [
  "想开法人账户，但不知道银行会看什么资料",
  "想找福冈本地的税理士、社劳士、装修、设备或店铺相关资源",
  "想做一个能介绍公司和服务的网站",
  "想把预约、订单、客户咨询从微信和纸面整理到线上",
  "想用 AI 做客户回复、说明文、菜单、SNS 或内部资料"
];

export default function FukuokaBusinessSupportPage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <p className={styles.eyebrow}>福冈本地实务支援 / 网站・业务工具制作</p>
          <h1>帮助在福冈开展业务的人，把实际要做的事情推进起来。</h1>
          <p className={styles.lead}>
            我主要为已经在福冈落地，或准备在福冈开展业务的客户，提供法人账户与公司手续支援、
            福冈本地资源对接、网站制作，以及预约・订单・业务工具制作。
          </p>
          <div className={styles.heroActions}>
            <a href="#packages" className={styles.primaryButton}>
              查看服务套餐
            </a>
            <a href="#contact-note" className={styles.secondaryButton}>
              初回 60 分钟免费
            </a>
          </div>
        </div>
        <div className={styles.heroPanel} aria-label="服务范围">
          <div>
            <span>01</span>
            <strong>法人账户・公司手续</strong>
          </div>
          <div>
            <span>02</span>
            <strong>福冈本地资源</strong>
          </div>
          <div>
            <span>03</span>
            <strong>网站制作</strong>
          </div>
          <div>
            <span>04</span>
            <strong>预约・订单・业务工具</strong>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <p className={styles.eyebrow}>What I Help With</p>
          <h2>不是经营顾问，而是实务推进和制作支援。</h2>
        </div>
        <div className={styles.statementGrid}>
          <div className={styles.statement}>
            <h3>我不会替客户决定事业方向。</h3>
            <p>
              如果你需要的是商业战略、融资判断、行业分析或经营决策，我会建议找更适合的专业顾问。
            </p>
          </div>
          <div className={styles.statement}>
            <h3>我擅长把已经明确的事情落到现实里。</h3>
            <p>
              例如开户资料、福冈本地资源、日语沟通路径、网站页面、预约表单、订单流程和简单业务工具。
            </p>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <p className={styles.eyebrow}>Common Requests</p>
          <h2>这些情况都可以先聊。</h2>
        </div>
        <div className={styles.exampleList}>
          {examples.map((example) => (
            <div key={example} className={styles.exampleItem}>
              {example}
            </div>
          ))}
        </div>
      </section>

      <section id="packages" className={styles.section}>
        <div className={styles.sectionHead}>
          <p className={styles.eyebrow}>Service Packages</p>
          <h2>服务套餐</h2>
          <p>初回面谈免费。正式支援会根据事项数量、沟通难度和制作范围调整报价。</p>
        </div>
        <div className={styles.packageGrid}>
          {packages.map((item) => (
            <article key={item.code} className={item.code === "A" ? styles.freeCard : styles.packageCard}>
              <div className={styles.cardTop}>
                <span>{item.code}</span>
                <small>{item.term}</small>
              </div>
              <h3>{item.name}</h3>
              <p className={styles.summary}>{item.summary}</p>
              <div className={styles.price}>{item.price}</div>
              <ul>
                {item.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.noteSection}>
        <div>
          <p className={styles.eyebrow}>Notes</p>
          <h2>关于报价和范围</h2>
        </div>
        <div className={styles.notes}>
          <p>
            法人账户开户支援不保证开户成功。服务重点是协助整理资料、准备说明、确认沟通路径，并根据情况推进补充对应。
          </p>
          <p>
            网站和业务工具的价格会根据页面数量、语言数量、预约/订单流程、后台管理、支付、会员功能等内容另行确认。
          </p>
          <p>
            本地资源对接不承诺最低价或一定成交，主要提供候选整理、沟通路径、预约和推进支援。
          </p>
        </div>
      </section>

      <section id="contact-note" className={styles.cta}>
        <p>第一次可以先免费聊 60 分钟。</p>
        <h2>如果你正在福冈准备开户、找资源、做网站或整理业务工具，可以先把目前情况发给我。</h2>
      </section>
    </main>
  );
}
